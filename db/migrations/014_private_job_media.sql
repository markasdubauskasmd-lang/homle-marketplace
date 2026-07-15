BEGIN;

ALTER TABLE booking_progress_events DROP CONSTRAINT booking_progress_events_event_type_check;
ALTER TABLE booking_progress_events ADD CONSTRAINT booking_progress_events_event_type_check CHECK (event_type IN ('cleaning-started', 'job-paused', 'job-resumed', 'task-updated', 'issue-reported', 'unexpected-task-added', 'unexpected-task-approved', 'unexpected-task-declined', 'photo-added', 'cleaning-finished'));

ALTER TABLE job_photos
  ADD COLUMN checksum_sha256 bytea,
  ADD COLUMN width_pixels integer CHECK (width_pixels BETWEEN 1 AND 20000),
  ADD COLUMN height_pixels integer CHECK (height_pixels BETWEEN 1 AND 20000),
  ADD COLUMN sanitized_at timestamptz;

CREATE TABLE job_photo_uploads (
  id uuid PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  task_id uuid REFERENCES cleaning_tasks(id) ON DELETE SET NULL,
  requested_by uuid NOT NULL REFERENCES cleaner_profiles(user_id),
  photo_type text NOT NULL CHECK (photo_type IN ('before', 'after', 'issue')),
  quarantine_storage_key text NOT NULL UNIQUE,
  final_storage_key text NOT NULL UNIQUE,
  requested_mime_type text NOT NULL CHECK (requested_mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  requested_byte_size integer NOT NULL CHECK (requested_byte_size BETWEEN 1 AND 15000000),
  requested_checksum_sha256 bytea NOT NULL,
  note text CHECK (char_length(note) <= 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired', 'rejected')),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  rejection_reason text CHECK (char_length(rejection_reason) <= 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX job_photo_uploads_expiry_idx ON job_photo_uploads(status, expires_at) WHERE status='pending';

ALTER TABLE job_photo_uploads ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_photo_uploads_participants ON job_photo_uploads USING (tideway_private.booking_participant(booking_id));

CREATE FUNCTION tideway_private.create_job_photo_upload_intent(
  proposed_upload_id uuid, target_booking_id uuid, target_task_id uuid, proposed_photo_type text,
  proposed_quarantine_key text, proposed_final_key text, proposed_mime_type text,
  proposed_byte_size integer, proposed_checksum_hex text, proposed_note text, proposed_expires_at timestamptz
) RETURNS job_photo_uploads
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); booking_record bookings%ROWTYPE; upload_record job_photo_uploads%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='cleaner-required'; END IF;
  IF proposed_upload_id IS NULL OR target_booking_id IS NULL OR proposed_photo_type IS NULL OR proposed_photo_type NOT IN ('before','after','issue') OR proposed_mime_type IS NULL OR proposed_mime_type NOT IN ('image/jpeg','image/png','image/webp','image/heic') OR proposed_byte_size IS NULL OR proposed_byte_size NOT BETWEEN 1 AND 15000000 OR proposed_checksum_hex IS NULL OR proposed_checksum_hex !~ '^[0-9a-f]{64}$' OR char_length(COALESCE(proposed_note,''))>1000 OR proposed_expires_at IS NULL OR proposed_expires_at<=now() OR proposed_expires_at>now()+interval '30 minutes' THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-photo-upload'; END IF;
  IF proposed_quarantine_key<>format('quarantine/job-photos/%s/%s',target_booking_id,proposed_upload_id) OR proposed_final_key<>format('job-photos/%s/%s.jpg',target_booking_id,proposed_upload_id) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-photo-storage-key'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND booking.cleaner_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='booking-not-found'; END IF;
  IF booking_record.status NOT IN ('cleaner-arrived','cleaning-in-progress','awaiting-review') OR (proposed_photo_type='before' AND booking_record.status='awaiting-review') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='photo-upload-not-allowed'; END IF;
  IF target_task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM cleaning_tasks task WHERE task.id=target_task_id AND task.booking_id=booking_record.id) THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='task-not-found'; END IF;
  INSERT INTO job_photo_uploads (id,booking_id,task_id,requested_by,photo_type,quarantine_storage_key,final_storage_key,requested_mime_type,requested_byte_size,requested_checksum_sha256,note,expires_at)
    VALUES (proposed_upload_id,booking_record.id,target_task_id,actor_id,proposed_photo_type,proposed_quarantine_key,proposed_final_key,proposed_mime_type,proposed_byte_size,decode(proposed_checksum_hex,'hex'),NULLIF(trim(proposed_note),''),proposed_expires_at)
    RETURNING * INTO upload_record;
  RETURN upload_record;
END;
$$;

CREATE FUNCTION tideway_private.reject_job_photo_upload(target_upload_id uuid, supplied_reason text)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); upload_record job_photo_uploads%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='cleaner-required'; END IF;
  IF supplied_reason IS NULL OR char_length(trim(supplied_reason)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-photo-rejection'; END IF;
  SELECT * INTO upload_record FROM job_photo_uploads upload WHERE upload.id=target_upload_id AND upload.requested_by=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='photo-upload-not-found'; END IF;
  IF upload_record.status='completed' THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='photo-upload-completed'; END IF;
  IF upload_record.status='pending' THEN UPDATE job_photo_uploads SET status='rejected',rejection_reason=trim(supplied_reason) WHERE id=upload_record.id; END IF;
END;
$$;

CREATE FUNCTION tideway_private.get_job_photo_upload_for_completion(target_upload_id uuid)
RETURNS job_photo_uploads
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); upload_record job_photo_uploads%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='cleaner-required'; END IF;
  SELECT * INTO upload_record FROM job_photo_uploads upload WHERE upload.id=target_upload_id AND upload.requested_by=actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='photo-upload-not-found'; END IF;
  IF upload_record.status='completed' THEN RETURN upload_record; END IF;
  IF upload_record.status<>'pending' OR upload_record.expires_at<=now() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='photo-upload-expired'; END IF;
  RETURN upload_record;
END;
$$;

CREATE FUNCTION tideway_private.complete_job_photo_upload(target_upload_id uuid, verified_output_byte_size integer, verified_output_checksum_hex text, verified_width integer, verified_height integer)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); upload_record job_photo_uploads%ROWTYPE; booking_record bookings%ROWTYPE; event_id bigint;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='cleaner-required'; END IF;
  IF verified_output_byte_size NOT BETWEEN 1 AND 15000000 OR verified_output_checksum_hex !~ '^[0-9a-f]{64}$' OR verified_width NOT BETWEEN 1 AND 20000 OR verified_height NOT BETWEEN 1 AND 20000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-verified-photo'; END IF;
  SELECT * INTO upload_record FROM job_photo_uploads upload WHERE upload.id=target_upload_id AND upload.requested_by=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='photo-upload-not-found'; END IF;
  IF upload_record.status='completed' THEN RETURN tideway_private.get_cleaning_progress(upload_record.booking_id); END IF;
  IF upload_record.status<>'pending' OR upload_record.expires_at<=now() THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='photo-upload-expired'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=upload_record.booking_id AND booking.cleaner_user_id=actor_id FOR UPDATE;
  IF NOT FOUND OR booking_record.status NOT IN ('cleaner-arrived','cleaning-in-progress','awaiting-review') THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='photo-upload-not-allowed'; END IF;
  INSERT INTO job_photos (id,booking_id,task_id,uploaded_by,photo_type,storage_key,mime_type,byte_size,checksum_sha256,width_pixels,height_pixels,sanitized_at,note)
    VALUES (upload_record.id,upload_record.booking_id,upload_record.task_id,actor_id,upload_record.photo_type,upload_record.final_storage_key,'image/jpeg',verified_output_byte_size,decode(verified_output_checksum_hex,'hex'),verified_width,verified_height,now(),upload_record.note);
  UPDATE job_photo_uploads SET status='completed',completed_at=now() WHERE id=upload_record.id;
  INSERT INTO booking_progress_events (booking_id,actor_user_id,event_type,payload) VALUES (upload_record.booking_id,actor_id,'photo-added',jsonb_build_object('photoId',upload_record.id,'taskId',upload_record.task_id,'photoType',upload_record.photo_type)) RETURNING id INTO event_id;
  INSERT INTO notifications (recipient_user_id,booking_id,event_type,channel,payload,idempotency_key) VALUES (booking_record.landlord_user_id,booking_record.id,CASE WHEN upload_record.photo_type='issue' THEN 'issue-photo-added' ELSE 'job-photo-added' END,'in-app',jsonb_build_object('bookingId',booking_record.id,'photoId',upload_record.id,'eventId',event_id),'progress:'||event_id) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN tideway_private.get_cleaning_progress(upload_record.booking_id);
END;
$$;

CREATE FUNCTION tideway_private.get_job_photo_object(target_booking_id uuid,target_photo_id uuid)
RETURNS TABLE(storage_key text,mime_type text,byte_size integer,checksum_hex text,photo_type text,note text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id();
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication-required'; END IF;
  RETURN QUERY SELECT photo.storage_key,photo.mime_type,photo.byte_size,encode(photo.checksum_sha256,'hex'),photo.photo_type,photo.note FROM job_photos photo JOIN bookings booking ON booking.id=photo.booking_id WHERE photo.id=target_photo_id AND photo.booking_id=target_booking_id AND (booking.landlord_user_id=actor_id OR booking.cleaner_user_id=actor_id OR tideway_private.has_role('administrator'));
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='photo-not-found'; END IF;
END;
$$;

CREATE FUNCTION tideway_private.expire_due_job_photo_uploads(batch_limit integer DEFAULT 500)
RETURNS TABLE(upload_id uuid,quarantine_storage_key text,final_storage_key text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE due job_photo_uploads%ROWTYPE;
BEGIN
  IF batch_limit IS NULL OR batch_limit<1 OR batch_limit>1000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-photo-expiry-limit'; END IF;
  FOR due IN SELECT * FROM job_photo_uploads upload WHERE upload.status='pending' AND upload.expires_at<=now() ORDER BY upload.expires_at,upload.id FOR UPDATE SKIP LOCKED LIMIT batch_limit LOOP
    UPDATE job_photo_uploads SET status='expired' WHERE id=due.id;
    upload_id:=due.id; quarantine_storage_key:=due.quarantine_storage_key; final_storage_key:=due.final_storage_key; RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.create_job_photo_upload_intent(uuid,uuid,uuid,text,text,text,text,integer,text,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_job_photo_upload_for_completion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.reject_job_photo_upload(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.complete_job_photo_upload(uuid,integer,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_job_photo_object(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.expire_due_job_photo_uploads(integer) FROM PUBLIC;

COMMIT;
