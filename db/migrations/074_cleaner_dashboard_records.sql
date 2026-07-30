BEGIN;

-- The Cleaner workspace contains private operational data that does not belong
-- on the public cleaner_profiles row. Every record is owned by the authenticated
-- Cleaner account created during email/password or social registration.
CREATE TABLE cleaner_onboarding_sections (
  cleaner_user_id uuid NOT NULL REFERENCES cleaner_profiles(user_id) ON DELETE CASCADE,
  section_code text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  completion_status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cleaner_user_id, section_code),
  CONSTRAINT cleaner_onboarding_section_code_valid CHECK (
    section_code IN (
      'personal-details', 'business-details', 'identity-verification',
      'background-checks', 'work-areas', 'experience', 'references',
      'insurance', 'availability', 'banking', 'equipment', 'documents', 'settings'
    )
  ),
  CONSTRAINT cleaner_onboarding_payload_object CHECK (
    jsonb_typeof(payload) = 'object' AND pg_column_size(payload) <= 65536
  ),
  CONSTRAINT cleaner_onboarding_status_valid CHECK (
    completion_status IN ('draft', 'complete', 'submitted', 'verified', 'needs-action')
  )
);

CREATE TABLE cleaner_documents (
  id uuid PRIMARY KEY,
  cleaner_user_id uuid NOT NULL REFERENCES cleaner_profiles(user_id) ON DELETE CASCADE,
  document_type text NOT NULL,
  original_file_name text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  byte_size integer NOT NULL,
  checksum_sha256 bytea NOT NULL,
  status text NOT NULL DEFAULT 'uploading',
  expires_at timestamptz,
  upload_expires_at timestamptz NOT NULL,
  uploaded_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cleaner_document_type_valid CHECK (
    document_type ~ '^[a-z][a-z0-9-]{1,63}$'
  ),
  CONSTRAINT cleaner_document_name_valid CHECK (
    char_length(original_file_name) BETWEEN 1 AND 180
    AND original_file_name !~ '[[:cntrl:]/\\]'
  ),
  CONSTRAINT cleaner_document_storage_key_valid CHECK (
    storage_key = 'cleaner-documents/' || cleaner_user_id::text || '/' || id::text
  ),
  CONSTRAINT cleaner_document_mime_valid CHECK (
    mime_type IN ('application/pdf', 'image/jpeg', 'image/png')
  ),
  CONSTRAINT cleaner_document_size_valid CHECK (byte_size BETWEEN 1 AND 20000000),
  CONSTRAINT cleaner_document_checksum_valid CHECK (octet_length(checksum_sha256) = 32),
  CONSTRAINT cleaner_document_status_valid CHECK (
    status IN ('uploading', 'pending-review', 'verified', 'rejected', 'expired')
  )
);

CREATE INDEX cleaner_documents_owner_created
  ON cleaner_documents (cleaner_user_id, created_at DESC);
CREATE INDEX cleaner_documents_review_queue
  ON cleaner_documents (status, created_at)
  WHERE status = 'pending-review';

CREATE TABLE cleaner_training_progress (
  cleaner_user_id uuid NOT NULL REFERENCES cleaner_profiles(user_id) ON DELETE CASCADE,
  module_code text NOT NULL,
  status text NOT NULL DEFAULT 'not-started',
  completed_lessons smallint NOT NULL DEFAULT 0,
  total_lessons smallint NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cleaner_user_id, module_code),
  CONSTRAINT cleaner_training_module_valid CHECK (module_code ~ '^[a-z][a-z0-9-]{1,79}$'),
  CONSTRAINT cleaner_training_status_valid CHECK (status IN ('not-started', 'in-progress', 'completed')),
  CONSTRAINT cleaner_training_lesson_counts_valid CHECK (
    total_lessons BETWEEN 1 AND 100
    AND completed_lessons BETWEEN 0 AND total_lessons
  )
);

CREATE TABLE cleaner_agreement_signatures (
  cleaner_user_id uuid NOT NULL REFERENCES cleaner_profiles(user_id) ON DELETE CASCADE,
  agreement_code text NOT NULL,
  policy_version text NOT NULL,
  signed_name text NOT NULL,
  signed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cleaner_user_id, agreement_code, policy_version),
  CONSTRAINT cleaner_agreement_code_valid CHECK (agreement_code ~ '^[a-z][a-z0-9-]{1,79}$'),
  CONSTRAINT cleaner_agreement_version_valid CHECK (
    char_length(policy_version) BETWEEN 1 AND 40
    AND policy_version ~ '^[A-Za-z0-9._-]+$'
  ),
  CONSTRAINT cleaner_agreement_name_valid CHECK (
    char_length(signed_name) BETWEEN 2 AND 120
    AND signed_name !~ '[[:cntrl:]]'
  )
);

ALTER TABLE cleaner_onboarding_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaner_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaner_training_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE cleaner_agreement_signatures ENABLE ROW LEVEL SECURITY;

CREATE POLICY cleaner_onboarding_owner_or_admin ON cleaner_onboarding_sections
  USING (cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'))
  WITH CHECK (cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY cleaner_documents_owner_or_admin ON cleaner_documents
  USING (cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'))
  WITH CHECK (cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY cleaner_training_owner_or_admin ON cleaner_training_progress
  USING (cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'))
  WITH CHECK (cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));
CREATE POLICY cleaner_agreements_owner_or_admin ON cleaner_agreement_signatures
  USING (cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'))
  WITH CHECK (cleaner_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'));

COMMIT;
