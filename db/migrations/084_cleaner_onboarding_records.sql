BEGIN;

CREATE TABLE cleaner_onboarding_sections (
  cleaner_user_id uuid NOT NULL REFERENCES cleaner_profiles(user_id) ON DELETE CASCADE,
  section_code text NOT NULL CHECK (section_code IN ('personal','business','identity','rtw','dbs','tax','experience','references','insurance','banking','equipment','transport','availability','areas','languages','skills','training','compliance')),
  payload_ciphertext bytea NOT NULL CHECK (octet_length(payload_ciphertext) BETWEEN 30 AND 131072),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','verified','rejected')),
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version BETWEEN 1 AND 1000),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cleaner_user_id, section_code),
  CHECK ((status IN ('submitted','verified') AND completed_at IS NOT NULL) OR (status IN ('draft','rejected')))
);

CREATE INDEX cleaner_onboarding_sections_status_idx ON cleaner_onboarding_sections(status, updated_at DESC);
ALTER TABLE cleaner_onboarding_sections ENABLE ROW LEVEL SECURITY;
CREATE POLICY cleaner_onboarding_owner_or_admin ON cleaner_onboarding_sections
  USING (cleaner_user_id=tideway_private.current_user_id() OR tideway_private.has_role('administrator'))
  WITH CHECK (cleaner_user_id=tideway_private.current_user_id() OR tideway_private.has_role('administrator'));

CREATE TABLE cleaner_onboarding_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaner_user_id uuid NOT NULL REFERENCES cleaner_profiles(user_id) ON DELETE CASCADE,
  section_code text NOT NULL CHECK (section_code IN ('personal','identity','rtw','dbs','tax','experience','references','insurance','training')),
  document_type text NOT NULL CHECK (char_length(document_type) BETWEEN 1 AND 80),
  object_key_ciphertext bytea NOT NULL CHECK (octet_length(object_key_ciphertext) BETWEEN 30 AND 4096),
  original_filename text NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 20971520),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[a-f0-9]{64}$'),
  status text NOT NULL DEFAULT 'uploaded' CHECK (status IN ('uploaded','scanning','pending','verified','rejected','expired','deleted')),
  expires_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cleaner_onboarding_documents_owner_idx ON cleaner_onboarding_documents(cleaner_user_id, section_code, created_at DESC);
ALTER TABLE cleaner_onboarding_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY cleaner_onboarding_documents_owner_or_admin ON cleaner_onboarding_documents
  USING (cleaner_user_id=tideway_private.current_user_id() OR tideway_private.has_role('administrator'))
  WITH CHECK (cleaner_user_id=tideway_private.current_user_id() OR tideway_private.has_role('administrator'));

CREATE FUNCTION tideway_private.get_my_cleaner_onboarding_sections()
RETURNS TABLE(cleaner_user_id uuid,section_code text,payload_ciphertext bytea,status text,schema_version smallint,completed_at timestamptz,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id();
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='cleaner-role-required'; END IF;
  RETURN QUERY SELECT record.cleaner_user_id,record.section_code,record.payload_ciphertext,record.status,record.schema_version,record.completed_at,record.updated_at
    FROM cleaner_onboarding_sections record WHERE record.cleaner_user_id=actor_id ORDER BY record.section_code;
END $$;

CREATE FUNCTION tideway_private.save_my_cleaner_onboarding_section(supplied_section text,supplied_ciphertext bytea,supplied_status text,supplied_schema_version smallint)
RETURNS TABLE(cleaner_user_id uuid,section_code text,payload_ciphertext bytea,status text,schema_version smallint,completed_at timestamptz,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id(); saved cleaner_onboarding_sections%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='cleaner-role-required'; END IF;
  IF supplied_status NOT IN ('draft','submitted') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-onboarding-status'; END IF;
  INSERT INTO cleaner_onboarding_sections(cleaner_user_id,section_code,payload_ciphertext,status,schema_version,completed_at)
    VALUES(actor_id,supplied_section,supplied_ciphertext,supplied_status,supplied_schema_version,CASE WHEN supplied_status='submitted' THEN now() ELSE NULL END)
    ON CONFLICT (cleaner_user_id,section_code) DO UPDATE SET payload_ciphertext=EXCLUDED.payload_ciphertext,status=EXCLUDED.status,schema_version=EXCLUDED.schema_version,completed_at=EXCLUDED.completed_at,updated_at=now()
    RETURNING * INTO saved;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
    VALUES(actor_id,'cleaner-onboarding-section-saved','cleaner_onboarding',supplied_section,jsonb_build_object('status',supplied_status,'schemaVersion',supplied_schema_version));
  RETURN QUERY SELECT saved.cleaner_user_id,saved.section_code,saved.payload_ciphertext,saved.status,saved.schema_version,saved.completed_at,saved.updated_at;
END $$;

REVOKE ALL ON TABLE cleaner_onboarding_sections,cleaner_onboarding_documents FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_my_cleaner_onboarding_sections() FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.save_my_cleaner_onboarding_section(text,bytea,text,smallint) FROM PUBLIC;

COMMIT;
