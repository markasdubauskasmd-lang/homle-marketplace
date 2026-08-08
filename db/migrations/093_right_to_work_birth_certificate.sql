BEGIN;

-- Extend the existing owner-only encrypted document writer with both Right to
-- Work evidence types. The document bytes and storage locator remain encrypted
-- before they reach PostgreSQL, exactly as they are for every other onboarding
-- document.
CREATE OR REPLACE FUNCTION tideway_private.save_my_cleaner_onboarding_document(
  supplied_section text,
  supplied_document_type text,
  supplied_object_key_ciphertext bytea,
  supplied_original_filename text,
  supplied_mime_type text,
  supplied_size_bytes integer,
  supplied_checksum_sha256 text,
  supplied_content_ciphertext bytea
)
RETURNS TABLE(
  id uuid,
  section_code text,
  document_type text,
  original_filename text,
  mime_type text,
  size_bytes integer,
  checksum_sha256 text,
  status text,
  expires_on date,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict error
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  saved cleaner_onboarding_documents%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='cleaner-role-required';
  END IF;
  IF NOT (
    (supplied_section='identity' AND supplied_document_type IN ('passportPhoto','licenceFront','licenceBack','birthCertificate','residencePermit'))
    OR (supplied_section='rtw' AND supplied_document_type IN ('rightToWorkPassport','rightToWorkBirthCertificate'))
    OR (supplied_section='dbs' AND supplied_document_type='dbsCertificate')
    OR (supplied_section='experience' AND supplied_document_type IN ('cv','cleaningCertificates','coshhCertificate','healthSafetyCertificate'))
    OR (supplied_section='references' AND supplied_document_type='referenceLetters')
    OR (supplied_section='insurance' AND supplied_document_type IN ('publicLiabilityPolicy','professionalIndemnityPolicy','employersLiabilityPolicy'))
    OR (supplied_section='banking' AND supplied_document_type='invoiceTemplate')
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-onboarding-document-type';
  END IF;

  SELECT document.* INTO saved
  FROM cleaner_onboarding_documents document
  WHERE document.cleaner_user_id=actor_id
    AND document.section_code=supplied_section
    AND document.document_type=supplied_document_type
    AND document.status<>'deleted'
  ORDER BY document.updated_at DESC
  LIMIT 1
  FOR UPDATE;

  IF saved.id IS NULL THEN
    INSERT INTO cleaner_onboarding_documents(
      cleaner_user_id,section_code,document_type,object_key_ciphertext,original_filename,mime_type,
      size_bytes,checksum_sha256,status,content_ciphertext
    ) VALUES (
      actor_id,supplied_section,supplied_document_type,supplied_object_key_ciphertext,supplied_original_filename,supplied_mime_type,
      supplied_size_bytes,supplied_checksum_sha256,'uploaded',supplied_content_ciphertext
    ) RETURNING * INTO saved;
  ELSE
    UPDATE cleaner_onboarding_documents document SET
      object_key_ciphertext=supplied_object_key_ciphertext,
      original_filename=supplied_original_filename,
      mime_type=supplied_mime_type,
      size_bytes=supplied_size_bytes,
      checksum_sha256=supplied_checksum_sha256,
      status='uploaded',
      content_ciphertext=supplied_content_ciphertext,
      updated_at=now()
    WHERE document.id=saved.id
    RETURNING document.* INTO saved;
  END IF;

  UPDATE cleaner_onboarding_documents document SET status='deleted',content_ciphertext=NULL,updated_at=now()
  WHERE document.cleaner_user_id=actor_id
    AND document.section_code=supplied_section
    AND document.document_type=supplied_document_type
    AND document.id<>saved.id
    AND document.status<>'deleted';

  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  VALUES(actor_id,'cleaner-onboarding-document-saved','cleaner_onboarding_document',saved.id::text,
    jsonb_build_object('section',saved.section_code,'documentType',saved.document_type,'mimeType',saved.mime_type,'sizeBytes',saved.size_bytes));

  RETURN QUERY SELECT saved.id,saved.section_code,saved.document_type,saved.original_filename,saved.mime_type,
    saved.size_bytes,saved.checksum_sha256,saved.status,saved.expires_on,saved.created_at,saved.updated_at;
END $$;

COMMIT;
