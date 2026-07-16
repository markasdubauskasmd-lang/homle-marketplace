BEGIN;

ALTER TABLE cleaning_request_photos
  ADD COLUMN checksum_sha256 bytea,
  ADD COLUMN width_pixels integer CHECK (width_pixels BETWEEN 1 AND 20000),
  ADD COLUMN height_pixels integer CHECK (height_pixels BETWEEN 1 AND 20000),
  ADD COLUMN sanitized_at timestamptz;

ALTER TABLE cleaning_requests
  ADD COLUMN scan_fingerprint character(64),
  ADD COLUMN customer_scope_confirmed_at timestamptz,
  ADD COLUMN cleaner_preview_authorized boolean NOT NULL DEFAULT false,
  ADD COLUMN submission_review_version smallint CHECK (submission_review_version=1);

ALTER TABLE cleaning_requests
  ADD CONSTRAINT cleaning_requests_scan_fingerprint_check CHECK (scan_fingerprint IS NULL OR scan_fingerprint ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT cleaning_requests_reviewed_submission_check CHECK (
    (status='draft' AND customer_scope_confirmed_at IS NULL AND scan_fingerprint IS NULL AND submission_review_version IS NULL)
    OR
    (status<>'draft' AND submission_review_version IS NULL AND customer_scope_confirmed_at IS NULL AND scan_fingerprint IS NULL)
    OR
    (status<>'draft' AND submission_review_version=1 AND customer_scope_confirmed_at IS NOT NULL AND scan_fingerprint IS NOT NULL)
  );

CREATE FUNCTION tideway_private.enforce_reviewed_request_submission()
RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.status<>'draft' AND (TG_OP='INSERT' OR (TG_OP='UPDATE' AND OLD.status='draft')) THEN
    IF NEW.submission_review_version IS DISTINCT FROM 1 OR NEW.customer_scope_confirmed_at IS NULL OR NEW.scan_fingerprint IS NULL THEN
      RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='reviewed-submission-required';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER cleaning_requests_reviewed_submission_guard BEFORE INSERT OR UPDATE OF status ON cleaning_requests FOR EACH ROW EXECUTE FUNCTION tideway_private.enforce_reviewed_request_submission();

CREATE TABLE cleaning_request_photo_uploads (
  id uuid PRIMARY KEY,
  cleaning_request_id uuid NOT NULL REFERENCES cleaning_requests(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES landlord_profiles(user_id),
  room_name text NOT NULL CHECK (char_length(room_name) BETWEEN 1 AND 120),
  note text NOT NULL CHECK (char_length(note) BETWEEN 1 AND 1000),
  quarantine_storage_key text NOT NULL UNIQUE,
  final_storage_key text NOT NULL UNIQUE,
  requested_mime_type text NOT NULL CHECK (requested_mime_type IN ('image/jpeg','image/png','image/webp','image/heic')),
  requested_byte_size integer NOT NULL CHECK (requested_byte_size BETWEEN 1 AND 15000000),
  requested_checksum_sha256 bytea NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','expired','rejected')),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  rejection_reason text CHECK (char_length(rejection_reason) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX cleaning_request_photo_uploads_expiry_idx ON cleaning_request_photo_uploads(status,expires_at) WHERE status='pending';
CREATE INDEX cleaning_request_photos_request_created_idx ON cleaning_request_photos(cleaning_request_id,created_at,id);
ALTER TABLE cleaning_request_photo_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_photo_uploads_owner_or_admin ON cleaning_request_photo_uploads USING (
  requested_by=tideway_private.current_user_id() OR tideway_private.has_role('administrator')
);

CREATE FUNCTION tideway_private.create_request_photo_upload_intent(
  proposed_upload_id uuid,target_request_id uuid,proposed_room_name text,proposed_note text,
  proposed_quarantine_key text,proposed_final_key text,proposed_mime_type text,
  proposed_byte_size integer,proposed_checksum_hex text,proposed_expires_at timestamptz
) RETURNS cleaning_request_photo_uploads
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); request_record cleaning_requests%ROWTYPE; upload_record cleaning_request_photo_uploads%ROWTYPE; active_count integer;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required'; END IF;
  IF proposed_upload_id IS NULL OR target_request_id IS NULL OR char_length(trim(COALESCE(proposed_room_name,''))) NOT BETWEEN 1 AND 120 OR char_length(trim(COALESCE(proposed_note,''))) NOT BETWEEN 1 AND 1000
    OR proposed_mime_type NOT IN ('image/jpeg','image/png','image/webp','image/heic') OR proposed_byte_size NOT BETWEEN 1 AND 15000000
    OR proposed_checksum_hex IS NULL OR proposed_checksum_hex !~ '^[0-9a-f]{64}$' OR proposed_expires_at IS NULL OR proposed_expires_at<=now() OR proposed_expires_at>now()+interval '30 minutes'
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-request-photo-upload'; END IF;
  IF proposed_quarantine_key<>format('quarantine/request-photos/%s/%s',target_request_id,proposed_upload_id)
    OR proposed_final_key<>format('request-photos/%s/%s.jpg',target_request_id,proposed_upload_id)
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-request-photo-storage-key'; END IF;
  SELECT * INTO request_record FROM cleaning_requests request WHERE request.id=target_request_id AND request.landlord_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-not-found'; END IF;
  IF request_record.status<>'draft' OR request_record.requested_start_at<=now()+interval '15 minutes' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-photo-upload-not-allowed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM cleaning_request_tasks task WHERE task.cleaning_request_id=request_record.id AND lower(trim(task.room_name))=lower(trim(proposed_room_name)))
  THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-photo-room-not-found'; END IF;
  SELECT count(*)::integer INTO active_count FROM cleaning_request_photo_uploads upload
    WHERE upload.cleaning_request_id=request_record.id AND (upload.status='completed' OR (upload.status='pending' AND upload.expires_at>now()));
  IF active_count>=10 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-photo-limit'; END IF;
  INSERT INTO cleaning_request_photo_uploads (id,cleaning_request_id,requested_by,room_name,note,quarantine_storage_key,final_storage_key,requested_mime_type,requested_byte_size,requested_checksum_sha256,expires_at)
    VALUES (proposed_upload_id,request_record.id,actor_id,trim(proposed_room_name),trim(proposed_note),proposed_quarantine_key,proposed_final_key,proposed_mime_type,proposed_byte_size,decode(proposed_checksum_hex,'hex'),proposed_expires_at)
    RETURNING * INTO upload_record;
  RETURN upload_record;
END;
$$;

CREATE FUNCTION tideway_private.get_request_photo_upload_for_completion(target_upload_id uuid)
RETURNS cleaning_request_photo_uploads
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); upload_record cleaning_request_photo_uploads%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required'; END IF;
  SELECT * INTO upload_record FROM cleaning_request_photo_uploads upload WHERE upload.id=target_upload_id AND upload.requested_by=actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-photo-upload-not-found'; END IF;
  IF upload_record.status='completed' THEN RETURN upload_record; END IF;
  IF upload_record.status<>'pending' OR upload_record.expires_at<=now() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-photo-upload-expired'; END IF;
  RETURN upload_record;
END;
$$;

CREATE FUNCTION tideway_private.reject_request_photo_upload(target_upload_id uuid,supplied_reason text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); upload_record cleaning_request_photo_uploads%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required'; END IF;
  IF char_length(trim(COALESCE(supplied_reason,''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-request-photo-rejection'; END IF;
  SELECT * INTO upload_record FROM cleaning_request_photo_uploads upload WHERE upload.id=target_upload_id AND upload.requested_by=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-photo-upload-not-found'; END IF;
  IF upload_record.status='completed' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-photo-upload-completed'; END IF;
  IF upload_record.status='pending' THEN UPDATE cleaning_request_photo_uploads SET status='rejected',rejection_reason=trim(supplied_reason) WHERE id=upload_record.id; END IF;
END;
$$;

CREATE FUNCTION tideway_private.get_cleaning_request_scan(target_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); request_record cleaning_requests%ROWTYPE; photos jsonb;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication-required'; END IF;
  SELECT * INTO request_record FROM cleaning_requests request WHERE request.id=target_request_id;
  IF NOT FOUND OR NOT (request_record.landlord_user_id=actor_id OR tideway_private.has_role('administrator') OR EXISTS (
    SELECT 1 FROM bookings booking WHERE booking.cleaning_request_id=request_record.id AND booking.cleaner_user_id=actor_id AND (
      booking.status IN ('confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review','completed')
      OR (request_record.cleaner_preview_authorized AND booking.status='pending-cleaner-acceptance')
    )
  )) THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-not-found'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object('photoId',photo.id,'roomName',photo.room_name,'note',photo.note,'mimeType',photo.mime_type,'byteSize',photo.byte_size,'width',photo.width_pixels,'height',photo.height_pixels,'createdAt',photo.created_at) ORDER BY photo.created_at,photo.id),'[]'::jsonb)
    INTO photos FROM cleaning_request_photos photo WHERE photo.cleaning_request_id=request_record.id AND photo.sanitized_at IS NOT NULL;
  RETURN jsonb_build_object('cleaningRequestId',request_record.id,'status',request_record.status,'photos',photos,'cleanerPreviewAuthorized',request_record.cleaner_preview_authorized,'scopeConfirmedAt',request_record.customer_scope_confirmed_at);
END;
$$;

CREATE FUNCTION tideway_private.complete_request_photo_upload(target_upload_id uuid,verified_output_byte_size integer,verified_output_checksum_hex text,verified_width integer,verified_height integer)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); upload_record cleaning_request_photo_uploads%ROWTYPE; request_record cleaning_requests%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required'; END IF;
  IF verified_output_byte_size NOT BETWEEN 1 AND 15000000 OR verified_output_checksum_hex !~ '^[0-9a-f]{64}$' OR verified_width NOT BETWEEN 1 AND 20000 OR verified_height NOT BETWEEN 1 AND 20000
  THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-verified-request-photo'; END IF;
  SELECT * INTO upload_record FROM cleaning_request_photo_uploads upload WHERE upload.id=target_upload_id AND upload.requested_by=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-photo-upload-not-found'; END IF;
  IF upload_record.status='completed' THEN RETURN tideway_private.get_cleaning_request_scan(upload_record.cleaning_request_id); END IF;
  IF upload_record.status<>'pending' OR upload_record.expires_at<=now() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-photo-upload-expired'; END IF;
  SELECT * INTO request_record FROM cleaning_requests request WHERE request.id=upload_record.cleaning_request_id AND request.landlord_user_id=actor_id FOR UPDATE;
  IF NOT FOUND OR request_record.status<>'draft' OR request_record.requested_start_at<=now()+interval '15 minutes' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-photo-upload-not-allowed'; END IF;
  INSERT INTO cleaning_request_photos (id,cleaning_request_id,storage_key,room_name,note,mime_type,byte_size,checksum_sha256,width_pixels,height_pixels,sanitized_at)
    VALUES (upload_record.id,upload_record.cleaning_request_id,upload_record.final_storage_key,upload_record.room_name,upload_record.note,'image/jpeg',verified_output_byte_size,decode(verified_output_checksum_hex,'hex'),verified_width,verified_height,now());
  UPDATE cleaning_request_photo_uploads SET status='completed',completed_at=now() WHERE id=upload_record.id;
  RETURN tideway_private.get_cleaning_request_scan(upload_record.cleaning_request_id);
END;
$$;

CREATE FUNCTION tideway_private.get_cleaning_request_photo_object(target_request_id uuid,target_photo_id uuid)
RETURNS TABLE(storage_key text,mime_type text,byte_size integer,checksum_hex text,room_name text,note text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); request_record cleaning_requests%ROWTYPE;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication-required'; END IF;
  SELECT * INTO request_record FROM cleaning_requests request WHERE request.id=target_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-photo-not-found'; END IF;
  IF NOT (request_record.landlord_user_id=actor_id OR tideway_private.has_role('administrator') OR EXISTS (
    SELECT 1 FROM bookings booking WHERE booking.cleaning_request_id=request_record.id AND booking.cleaner_user_id=actor_id AND (
      booking.status IN ('confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review','completed')
      OR (request_record.cleaner_preview_authorized AND booking.status='pending-cleaner-acceptance')
    )
  )) THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-photo-not-found'; END IF;
  RETURN QUERY SELECT photo.storage_key,photo.mime_type,photo.byte_size,encode(photo.checksum_sha256,'hex'),photo.room_name,photo.note
    FROM cleaning_request_photos photo WHERE photo.id=target_photo_id AND photo.cleaning_request_id=request_record.id AND photo.sanitized_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-photo-not-found'; END IF;
END;
$$;

CREATE FUNCTION tideway_private.submit_cleaning_request(target_request_id uuid,scope_reviewed boolean,preview_authorized boolean)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); request_record cleaning_requests%ROWTYPE; task_count integer; photo_count integer; pending_count integer; scan_hash text; scope_hash text;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required'; END IF;
  IF scope_reviewed IS NOT TRUE OR preview_authorized IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='request-review-required'; END IF;
  SELECT * INTO request_record FROM cleaning_requests request WHERE request.id=target_request_id AND request.landlord_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-not-found'; END IF;
  IF request_record.status<>'draft' OR request_record.requested_start_at<=now()+interval '15 minutes' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-not-submittable'; END IF;
  SELECT count(*)::integer INTO task_count FROM cleaning_request_tasks task WHERE task.cleaning_request_id=request_record.id;
  SELECT count(*)::integer INTO photo_count FROM cleaning_request_photos photo WHERE photo.cleaning_request_id=request_record.id AND photo.sanitized_at IS NOT NULL;
  SELECT count(*)::integer INTO pending_count FROM cleaning_request_photo_uploads upload WHERE upload.cleaning_request_id=request_record.id AND upload.status='pending' AND upload.expires_at>now();
  IF task_count<1 OR photo_count<1 OR photo_count>10 OR pending_count>0 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-scan-incomplete'; END IF;
  IF EXISTS (SELECT 1 FROM cleaning_request_photos photo WHERE photo.cleaning_request_id=request_record.id AND NOT EXISTS (
    SELECT 1 FROM cleaning_request_tasks task WHERE task.cleaning_request_id=request_record.id AND lower(trim(task.room_name))=lower(trim(photo.room_name))
  )) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-scan-room-mismatch'; END IF;
  SELECT encode(digest(string_agg(concat_ws('|',photo.id::text,photo.room_name,photo.note,photo.mime_type,photo.byte_size::text,encode(photo.checksum_sha256,'hex'),photo.width_pixels::text,photo.height_pixels::text),E'\n' ORDER BY photo.created_at,photo.id),'sha256'),'hex')
    INTO scan_hash FROM cleaning_request_photos photo WHERE photo.cleaning_request_id=request_record.id AND photo.sanitized_at IS NOT NULL;
  SELECT encode(digest(concat_ws('|',request_record.scope_fingerprint,scan_hash),'sha256'),'hex') INTO scope_hash;
  UPDATE cleaning_requests SET status='searching-for-cleaner',submitted_at=now(),customer_scope_confirmed_at=now(),cleaner_preview_authorized=preview_authorized,submission_review_version=1,scan_fingerprint=scan_hash,scope_fingerprint=scope_hash,updated_at=now()
    WHERE id=request_record.id;
  INSERT INTO cleaning_request_status_history (cleaning_request_id,from_status,to_status,changed_by,reason,metadata)
    VALUES (request_record.id,'draft','searching-for-cleaner',actor_id,'Landlord reviewed the room scan and submitted the request for matching.',jsonb_build_object('scopeFingerprint',scope_hash,'scanFingerprint',scan_hash,'photoCount',photo_count,'taskCount',task_count,'cleanerPreviewAuthorized',preview_authorized));
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
    VALUES(actor_id,'cleaning-request-submitted','cleaning-request',request_record.id::text,jsonb_build_object('scopeFingerprint',scope_hash,'scanFingerprint',scan_hash,'photoCount',photo_count,'taskCount',task_count,'cleanerPreviewAuthorized',preview_authorized));
  RETURN jsonb_build_object('cleaningRequestId',request_record.id,'status','searching-for-cleaner','submittedAt',now(),'scopeConfirmedAt',now(),'cleanerPreviewAuthorized',preview_authorized,'scanFingerprint',scan_hash,'photoCount',photo_count,'taskCount',task_count);
END;
$$;

CREATE FUNCTION tideway_private.expire_due_request_photo_uploads(batch_limit integer DEFAULT 500)
RETURNS TABLE(upload_id uuid,quarantine_storage_key text,final_storage_key text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE due cleaning_request_photo_uploads%ROWTYPE;
BEGIN
  IF batch_limit IS NULL OR batch_limit<1 OR batch_limit>1000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-request-photo-expiry-limit'; END IF;
  FOR due IN SELECT * FROM cleaning_request_photo_uploads upload WHERE upload.status='pending' AND upload.expires_at<=now() ORDER BY upload.expires_at,upload.id FOR UPDATE SKIP LOCKED LIMIT batch_limit LOOP
    UPDATE cleaning_request_photo_uploads SET status='expired' WHERE id=due.id;
    upload_id:=due.id; quarantine_storage_key:=due.quarantine_storage_key; final_storage_key:=due.final_storage_key; RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.create_request_photo_upload_intent(uuid,uuid,text,text,text,text,text,integer,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_request_photo_upload_for_completion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.reject_request_photo_upload(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.complete_request_photo_upload(uuid,integer,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_cleaning_request_scan(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_cleaning_request_photo_object(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.submit_cleaning_request(uuid,boolean,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.expire_due_request_photo_uploads(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.enforce_reviewed_request_submission() FROM PUBLIC;

COMMIT;
