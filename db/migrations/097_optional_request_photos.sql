BEGIN;

-- Room photos improve the handoff but are not part of the minimum booking
-- contract. Keep the actionable Cleaner task and pending-upload checks, while
-- allowing a reviewed request to carry zero sanitized photos.
CREATE OR REPLACE FUNCTION tideway_private.submit_cleaning_request(target_request_id uuid,scope_reviewed boolean,preview_authorized boolean)
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
  IF task_count<1 OR photo_count>10 OR pending_count>0 THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-scan-incomplete'; END IF;
  IF EXISTS (SELECT 1 FROM cleaning_request_photos photo WHERE photo.cleaning_request_id=request_record.id AND NOT EXISTS (
    SELECT 1 FROM cleaning_request_tasks task WHERE task.cleaning_request_id=request_record.id AND lower(trim(task.room_name))=lower(trim(photo.room_name))
  )) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-scan-room-mismatch'; END IF;
  SELECT encode(digest(COALESCE(string_agg(concat_ws('|',photo.id::text,photo.room_name,photo.note,photo.mime_type,photo.byte_size::text,encode(photo.checksum_sha256,'hex'),photo.width_pixels::text,photo.height_pixels::text),E'\n' ORDER BY photo.created_at,photo.id),'no-room-photos'),'sha256'),'hex')
    INTO scan_hash FROM cleaning_request_photos photo WHERE photo.cleaning_request_id=request_record.id AND photo.sanitized_at IS NOT NULL;
  SELECT encode(digest(concat_ws('|',request_record.scope_fingerprint,scan_hash),'sha256'),'hex') INTO scope_hash;
  UPDATE cleaning_requests SET status='searching-for-cleaner',submitted_at=now(),customer_scope_confirmed_at=now(),cleaner_preview_authorized=preview_authorized,submission_review_version=1,scan_fingerprint=scan_hash,scope_fingerprint=scope_hash,updated_at=now()
    WHERE id=request_record.id;
  INSERT INTO cleaning_request_status_history (cleaning_request_id,from_status,to_status,changed_by,reason,metadata)
    VALUES (request_record.id,'draft','searching-for-cleaner',actor_id,'Landlord reviewed the Cleaner brief and submitted the request for matching.',jsonb_build_object('scopeFingerprint',scope_hash,'scanFingerprint',scan_hash,'photoCount',photo_count,'taskCount',task_count,'cleanerPreviewAuthorized',preview_authorized));
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
    VALUES(actor_id,'cleaning-request-submitted','cleaning-request',request_record.id::text,jsonb_build_object('scopeFingerprint',scope_hash,'scanFingerprint',scan_hash,'photoCount',photo_count,'taskCount',task_count,'cleanerPreviewAuthorized',preview_authorized));
  RETURN jsonb_build_object('cleaningRequestId',request_record.id,'status','searching-for-cleaner','submittedAt',now(),'scopeConfirmedAt',now(),'cleanerPreviewAuthorized',preview_authorized,'scanFingerprint',scan_hash,'photoCount',photo_count,'taskCount',task_count);
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.submit_cleaning_request(uuid,boolean,boolean) FROM PUBLIC;

COMMIT;
