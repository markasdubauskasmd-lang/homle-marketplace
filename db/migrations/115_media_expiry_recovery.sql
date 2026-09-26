-- Expired upload tombstones survive external-storage failures and process crashes.
-- Existing expiry/ownership decisions are unchanged; completed media is excluded.
-- Re-sweep acknowledged keys daily because a pre-expiry PUT or sanitizer can
-- finish after deletion. There is no fabricated hard bound on provider writes.
BEGIN;
ALTER TABLE job_photo_uploads ADD COLUMN cleanup_attempted_at timestamptz, ADD COLUMN cleanup_completed_at timestamptz;
CREATE INDEX job_photo_uploads_cleanup_idx ON job_photo_uploads(cleanup_completed_at,cleanup_attempted_at,expires_at) WHERE status='expired';
CREATE OR REPLACE FUNCTION tideway_private.expire_due_job_photo_uploads(batch_limit integer DEFAULT 500)
RETURNS TABLE(upload_id uuid,quarantine_storage_key text,final_storage_key text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE due job_photo_uploads%ROWTYPE;
BEGIN
  IF batch_limit IS NULL OR batch_limit<1 OR batch_limit>1000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-photo-expiry-limit'; END IF;
  FOR due IN SELECT upload.* FROM job_photo_uploads upload
    WHERE (upload.status='pending' AND upload.expires_at<=now())
       OR (upload.status='expired' AND (upload.cleanup_completed_at IS NULL OR upload.cleanup_completed_at<=now()-interval '1 day'))
    ORDER BY CASE WHEN upload.cleanup_completed_at IS NULL OR upload.cleanup_attempted_at>upload.cleanup_completed_at THEN 0 ELSE 1 END,
      COALESCE(upload.cleanup_attempted_at,upload.expires_at),upload.id
    FOR UPDATE SKIP LOCKED LIMIT batch_limit LOOP
    UPDATE job_photo_uploads SET status='expired',cleanup_attempted_at=clock_timestamp() WHERE id=due.id;
    upload_id:=due.id; quarantine_storage_key:=due.quarantine_storage_key; final_storage_key:=due.final_storage_key; RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;
CREATE FUNCTION tideway_private.acknowledge_job_photo_upload_cleanup(target_upload_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  UPDATE job_photo_uploads SET cleanup_completed_at=clock_timestamp()
    WHERE id=target_upload_id AND status='expired' AND cleanup_attempted_at IS NOT NULL;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION tideway_private.acknowledge_job_photo_upload_cleanup(uuid) FROM PUBLIC;
ALTER TABLE cleaning_request_photo_uploads ADD COLUMN cleanup_attempted_at timestamptz, ADD COLUMN cleanup_completed_at timestamptz;
CREATE INDEX cleaning_request_photo_uploads_cleanup_idx ON cleaning_request_photo_uploads(cleanup_completed_at,cleanup_attempted_at,expires_at) WHERE status='expired';
CREATE OR REPLACE FUNCTION tideway_private.expire_due_request_photo_uploads(batch_limit integer DEFAULT 500)
RETURNS TABLE(upload_id uuid,quarantine_storage_key text,final_storage_key text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE due cleaning_request_photo_uploads%ROWTYPE;
BEGIN
  IF batch_limit IS NULL OR batch_limit<1 OR batch_limit>1000 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-request-photo-expiry-limit'; END IF;
  FOR due IN SELECT upload.* FROM cleaning_request_photo_uploads upload
    WHERE (upload.status='pending' AND upload.expires_at<=now())
       OR (upload.status='expired' AND (upload.cleanup_completed_at IS NULL OR upload.cleanup_completed_at<=now()-interval '1 day'))
    ORDER BY CASE WHEN upload.cleanup_completed_at IS NULL OR upload.cleanup_attempted_at>upload.cleanup_completed_at THEN 0 ELSE 1 END,
      COALESCE(upload.cleanup_attempted_at,upload.expires_at),upload.id
    FOR UPDATE SKIP LOCKED LIMIT batch_limit LOOP
    UPDATE cleaning_request_photo_uploads SET status='expired',cleanup_attempted_at=clock_timestamp() WHERE id=due.id;
    upload_id:=due.id; quarantine_storage_key:=due.quarantine_storage_key; final_storage_key:=due.final_storage_key; RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;
CREATE FUNCTION tideway_private.acknowledge_request_photo_upload_cleanup(target_upload_id uuid)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  UPDATE cleaning_request_photo_uploads SET cleanup_completed_at=clock_timestamp()
    WHERE id=target_upload_id AND status='expired' AND cleanup_attempted_at IS NOT NULL;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION tideway_private.acknowledge_request_photo_upload_cleanup(uuid) FROM PUBLIC;
COMMIT;
