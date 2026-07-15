BEGIN;

ALTER TABLE cleaning_requests DROP CONSTRAINT cleaning_requests_status_check;
UPDATE cleaning_requests SET status = CASE status
  WHEN 'searching' THEN 'searching-for-cleaner'
  WHEN 'invited' THEN 'cleaner-invited'
  WHEN 'closed' THEN 'cancelled'
  ELSE status
END;
ALTER TABLE cleaning_requests ADD CONSTRAINT cleaning_requests_status_check CHECK (status IN ('draft', 'searching-for-cleaner', 'cleaner-invited', 'pending-cleaner-acceptance', 'matched', 'cancelled'));
ALTER TABLE cleaning_requests ADD COLUMN scope_fingerprint character(64);
UPDATE cleaning_requests
SET scope_fingerprint = encode(digest(concat_ws('|', id::text, property_id::text, requested_start_at::text, requested_end_at::text, cleaning_type, required_services::text, COALESCE(special_instructions, ''), COALESCE(budget_pence::text, ''), COALESCE(recurrence_rule, '')), 'sha256'), 'hex');
ALTER TABLE cleaning_requests ALTER COLUMN scope_fingerprint SET NOT NULL;
ALTER TABLE cleaning_requests ADD CONSTRAINT cleaning_requests_scope_fingerprint_check CHECK (scope_fingerprint ~ '^[0-9a-f]{64}$');
ALTER TABLE cleaning_requests ADD COLUMN submitted_at timestamptz;
UPDATE cleaning_requests SET submitted_at = created_at WHERE status <> 'draft';
ALTER TABLE cleaning_requests ADD CONSTRAINT cleaning_requests_submission_state_check CHECK ((status = 'draft' AND submitted_at IS NULL) OR (status <> 'draft' AND submitted_at IS NOT NULL));

CREATE TABLE cleaning_request_status_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  cleaning_request_id uuid NOT NULL REFERENCES cleaning_requests(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL CHECK (to_status IN ('draft', 'searching-for-cleaner', 'cleaner-invited', 'pending-cleaner-acceptance', 'matched', 'cancelled')),
  changed_by uuid NOT NULL REFERENCES users(id),
  reason text CHECK (char_length(reason) <= 2000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cleaning_request_status_history_request_idx ON cleaning_request_status_history(cleaning_request_id, created_at);
ALTER TABLE cleaning_request_status_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_history_owner_or_admin ON cleaning_request_status_history USING (
  EXISTS (
    SELECT 1 FROM cleaning_requests request
    WHERE request.id = cleaning_request_status_history.cleaning_request_id
      AND (request.landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator'))
  )
) WITH CHECK (
  (
    changed_by = tideway_private.current_user_id()
    AND EXISTS (
      SELECT 1 FROM cleaning_requests request
      WHERE request.id = cleaning_request_status_history.cleaning_request_id
        AND request.landlord_user_id = tideway_private.current_user_id()
    )
  )
  OR tideway_private.has_role('administrator')
);

COMMIT;
