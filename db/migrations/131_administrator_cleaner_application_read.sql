-- Let the person approving a Cleaner actually see the application.
--
-- The vetting queue showed a name, two status strings and a public flag. The
-- submitted application -- the right-to-work answers, the declared identity,
-- the uploaded document list -- is encrypted per section and had no
-- administrator read path at all. So approval was made blind: an Administrator
-- marked somebody's identity check `verified` without ever seeing what they
-- submitted, and that approval is what puts a stranger in a customer's home.
-- It is the single most consequential decision in this product and it was the
-- least informed.
--
-- This is a deliberate, narrow widening of access to somebody's identity
-- documents, so the conditions are part of the function rather than left to
-- the caller:
--
--   * Administrator only, checked here and not merely at the route.
--   * Only a Cleaner who has actually SUBMITTED an application. A Cleaner
--     halfway through typing their passport number into a draft is not under
--     review, and nobody needs to read that.
--   * Every read writes an audit row naming the Administrator, the Cleaner and
--     the time. Looking at somebody's identity documents is an event, not a
--     page view, and it has to be answerable later -- to the Cleaner, and to a
--     regulator asking who saw what.
--   * The ciphertext is returned; the decryption key lives in the application
--     and never in the database. This function cannot read what it returns.
--
-- What it does NOT return: the document bytes. Those stay behind their own
-- fetch, so a queue page cannot pull a stack of passport scans into memory as
-- a side effect of being opened. Metadata -- type, filename, expiry, checksum
-- -- is enough to see that a document exists and is current, which is what the
-- approval decision actually turns on.

BEGIN;

CREATE FUNCTION tideway_private.get_cleaner_application_for_administrator(target_cleaner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  submitted boolean;
  result jsonb;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM cleaner_profiles profile WHERE profile.user_id = target_cleaner_id) THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='cleaner-not-found';
  END IF;

  -- "Submitted" is the review section reaching a terminal state, which is the
  -- same signal `cleanerSubmissionReadiness` reads in the application. A draft
  -- is not under review and is not readable here.
  SELECT EXISTS (
    SELECT 1 FROM cleaner_onboarding_sections section
    WHERE section.cleaner_user_id = target_cleaner_id
      AND section.section_code = 'review'
      AND section.status IN ('submitted','verified')
  ) INTO submitted;
  IF NOT submitted THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='cleaner-application-not-submitted';
  END IF;

  SELECT jsonb_build_object(
    'cleanerId', target_cleaner_id,
    'sections', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'section', section.section_code,
        -- Returned encrypted. The key is held by the application, so this
        -- function cannot read what it hands back, and a database backup is
        -- not a pile of identity documents.
        'payloadCiphertext', encode(section.payload_ciphertext, 'base64'),
        'status', section.status,
        'schemaVersion', section.schema_version,
        'completedAt', section.completed_at,
        'updatedAt', section.updated_at
      ) ORDER BY section.section_code)
      FROM cleaner_onboarding_sections section
      WHERE section.cleaner_user_id = target_cleaner_id
    ), '[]'::jsonb),
    'documents', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'documentId', document.id,
        'section', document.section_code,
        'documentType', document.document_type,
        'originalFilename', document.original_filename,
        'mimeType', document.mime_type,
        'sizeBytes', document.size_bytes,
        'checksumSha256', document.checksum_sha256,
        'status', document.status,
        'expiresOn', document.expires_on,
        'createdAt', document.created_at
      ) ORDER BY document.section_code, document.document_type, document.created_at)
      FROM cleaner_onboarding_documents document
      WHERE document.cleaner_user_id = target_cleaner_id
    ), '[]'::jsonb)
  ) INTO result;

  -- Written on every read, including a repeated one. A second look is a second
  -- event; collapsing them would make the trail describe curiosity as a single
  -- visit.
  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (
      actor_id,
      'cleaner-application-read',
      'cleaner_profile',
      target_cleaner_id::text,
      jsonb_build_object('reason', 'vetting-review')
    );

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.get_cleaner_application_for_administrator(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tideway_private.get_cleaner_application_for_administrator(uuid) TO tideway_app;

COMMIT;
