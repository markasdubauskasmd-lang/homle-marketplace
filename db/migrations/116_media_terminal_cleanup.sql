-- Recover only deletion already required by completion/rejection.
-- Completed final images are NEVER returned. Terminal states and reasons persist.
BEGIN;
ALTER TABLE job_photo_uploads ADD COLUMN terminal_cleanup_attempted_at timestamptz, ADD COLUMN terminal_cleanup_completed_at timestamptz;
CREATE INDEX job_photo_uploads_terminal_cleanup_idx ON job_photo_uploads(terminal_cleanup_completed_at,terminal_cleanup_attempted_at,expires_at) WHERE status IN ('completed','rejected');
CREATE FUNCTION tideway_private.claim_job_photo_terminal_cleanup(batch_limit integer DEFAULT 10)
RETURNS TABLE(upload_id uuid,upload_status text,cleanup_keys text[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE due job_photo_uploads%ROWTYPE;
BEGIN
  IF batch_limit IS NULL OR batch_limit<1 OR batch_limit>10 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-terminal-cleanup-limit'; END IF;
  FOR due IN SELECT upload.* FROM job_photo_uploads upload
    WHERE upload.status IN ('completed','rejected') AND upload.expires_at<=now()
      AND (upload.terminal_cleanup_completed_at IS NULL OR upload.terminal_cleanup_completed_at<=now()-interval '1 day')
    ORDER BY CASE WHEN upload.terminal_cleanup_completed_at IS NULL OR upload.terminal_cleanup_attempted_at>upload.terminal_cleanup_completed_at THEN 0 ELSE 1 END,
      COALESCE(upload.terminal_cleanup_attempted_at,upload.expires_at),upload.id
    FOR UPDATE SKIP LOCKED LIMIT batch_limit LOOP
    UPDATE job_photo_uploads SET terminal_cleanup_attempted_at=clock_timestamp() WHERE id=due.id;
    upload_id:=due.id; upload_status:=due.status;
    cleanup_keys:=CASE WHEN due.status='completed' THEN ARRAY[due.quarantine_storage_key] ELSE ARRAY[due.quarantine_storage_key,due.final_storage_key] END;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;
CREATE FUNCTION tideway_private.acknowledge_job_photo_terminal_cleanup(target_upload_id uuid,expected_status text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF expected_status IS NULL OR expected_status NOT IN ('completed','rejected') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-terminal-cleanup-status'; END IF;
  UPDATE job_photo_uploads SET terminal_cleanup_completed_at=clock_timestamp()
    WHERE id=target_upload_id AND status=expected_status AND expires_at<=now() AND terminal_cleanup_attempted_at IS NOT NULL;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION tideway_private.claim_job_photo_terminal_cleanup(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.acknowledge_job_photo_terminal_cleanup(uuid,text) FROM PUBLIC;
ALTER TABLE cleaning_request_photo_uploads ADD COLUMN terminal_cleanup_attempted_at timestamptz, ADD COLUMN terminal_cleanup_completed_at timestamptz;
CREATE INDEX cleaning_request_photo_uploads_terminal_cleanup_idx ON cleaning_request_photo_uploads(terminal_cleanup_completed_at,terminal_cleanup_attempted_at,expires_at) WHERE status IN ('completed','rejected');
CREATE FUNCTION tideway_private.claim_request_photo_terminal_cleanup(batch_limit integer DEFAULT 10)
RETURNS TABLE(upload_id uuid,upload_status text,cleanup_keys text[])
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE due cleaning_request_photo_uploads%ROWTYPE;
BEGIN
  IF batch_limit IS NULL OR batch_limit<1 OR batch_limit>10 THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-terminal-cleanup-limit'; END IF;
  FOR due IN SELECT upload.* FROM cleaning_request_photo_uploads upload
    WHERE upload.status IN ('completed','rejected') AND upload.expires_at<=now()
      AND (upload.terminal_cleanup_completed_at IS NULL OR upload.terminal_cleanup_completed_at<=now()-interval '1 day')
    ORDER BY CASE WHEN upload.terminal_cleanup_completed_at IS NULL OR upload.terminal_cleanup_attempted_at>upload.terminal_cleanup_completed_at THEN 0 ELSE 1 END,
      COALESCE(upload.terminal_cleanup_attempted_at,upload.expires_at),upload.id
    FOR UPDATE SKIP LOCKED LIMIT batch_limit LOOP
    UPDATE cleaning_request_photo_uploads SET terminal_cleanup_attempted_at=clock_timestamp() WHERE id=due.id;
    upload_id:=due.id; upload_status:=due.status;
    cleanup_keys:=CASE WHEN due.status='completed' THEN ARRAY[due.quarantine_storage_key] ELSE ARRAY[due.quarantine_storage_key,due.final_storage_key] END;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;
CREATE FUNCTION tideway_private.acknowledge_request_photo_terminal_cleanup(target_upload_id uuid,expected_status text)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF expected_status IS NULL OR expected_status NOT IN ('completed','rejected') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-terminal-cleanup-status'; END IF;
  UPDATE cleaning_request_photo_uploads SET terminal_cleanup_completed_at=clock_timestamp()
    WHERE id=target_upload_id AND status=expected_status AND expires_at<=now() AND terminal_cleanup_attempted_at IS NOT NULL;
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION tideway_private.claim_request_photo_terminal_cleanup(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.acknowledge_request_photo_terminal_cleanup(uuid,text) FROM PUBLIC;
COMMIT;
