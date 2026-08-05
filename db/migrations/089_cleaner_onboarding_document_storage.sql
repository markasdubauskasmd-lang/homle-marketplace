BEGIN;

ALTER TABLE cleaner_onboarding_documents
  DROP CONSTRAINT IF EXISTS cleaner_onboarding_documents_section_code_check;

ALTER TABLE cleaner_onboarding_documents
  ADD CONSTRAINT cleaner_onboarding_documents_section_code_check
  CHECK (section_code IN ('personal','identity','rtw','dbs','tax','experience','references','insurance','banking','training'));

ALTER TABLE cleaner_onboarding_documents
  ADD COLUMN content_ciphertext bytea
  CHECK (content_ciphertext IS NULL OR octet_length(content_ciphertext) BETWEEN 30 AND 20971549);

CREATE FUNCTION tideway_private.list_my_cleaner_onboarding_documents(supplied_section text DEFAULT NULL)
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
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict error
DECLARE actor_id uuid := tideway_private.current_user_id();
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='cleaner-role-required';
  END IF;
  RETURN QUERY
    SELECT document.id,document.section_code,document.document_type,document.original_filename,document.mime_type,
      document.size_bytes,document.checksum_sha256,document.status,document.expires_on,document.created_at,document.updated_at
    FROM cleaner_onboarding_documents document
    WHERE document.cleaner_user_id=actor_id
      AND document.status<>'deleted'
      AND document.content_ciphertext IS NOT NULL
      AND (supplied_section IS NULL OR document.section_code=supplied_section)
    ORDER BY document.section_code,document.document_type,document.updated_at DESC;
END $$;

CREATE FUNCTION tideway_private.save_my_cleaner_onboarding_document(
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

CREATE FUNCTION tideway_private.get_my_cleaner_onboarding_document(supplied_section text,supplied_document_type text)
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
  content_ciphertext bytea,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
#variable_conflict error
DECLARE actor_id uuid := tideway_private.current_user_id();
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='cleaner-role-required';
  END IF;
  RETURN QUERY
    SELECT document.id,document.section_code,document.document_type,document.original_filename,document.mime_type,
      document.size_bytes,document.checksum_sha256,document.status,document.expires_on,document.content_ciphertext,
      document.created_at,document.updated_at
    FROM cleaner_onboarding_documents document
    WHERE document.cleaner_user_id=actor_id
      AND document.section_code=supplied_section
      AND document.document_type=supplied_document_type
      AND document.status<>'deleted'
      AND document.content_ciphertext IS NOT NULL
    ORDER BY document.updated_at DESC
    LIMIT 1;
END $$;

CREATE FUNCTION tideway_private.delete_my_cleaner_onboarding_document(supplied_section text,supplied_document_type text)
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
DECLARE actor_id uuid := tideway_private.current_user_id(); deleted cleaner_onboarding_documents%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='cleaner-role-required';
  END IF;
  UPDATE cleaner_onboarding_documents document SET status='deleted',content_ciphertext=NULL,updated_at=now()
  WHERE document.id=(
    SELECT selected.id FROM cleaner_onboarding_documents selected
    WHERE selected.cleaner_user_id=actor_id
      AND selected.section_code=supplied_section
      AND selected.document_type=supplied_document_type
      AND selected.status<>'deleted'
    ORDER BY selected.updated_at DESC LIMIT 1
  )
  RETURNING document.* INTO deleted;
  IF deleted.id IS NULL THEN RETURN; END IF;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  VALUES(actor_id,'cleaner-onboarding-document-deleted','cleaner_onboarding_document',deleted.id::text,
    jsonb_build_object('section',deleted.section_code,'documentType',deleted.document_type));
  RETURN QUERY SELECT deleted.id,deleted.section_code,deleted.document_type,deleted.original_filename,deleted.mime_type,
    deleted.size_bytes,deleted.checksum_sha256,deleted.status,deleted.expires_on,deleted.created_at,deleted.updated_at;
END $$;

REVOKE ALL ON FUNCTION tideway_private.list_my_cleaner_onboarding_documents(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.save_my_cleaner_onboarding_document(text,text,bytea,text,text,integer,text,bytea) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_my_cleaner_onboarding_document(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.delete_my_cleaner_onboarding_document(text,text) FROM PUBLIC;

COMMIT;
