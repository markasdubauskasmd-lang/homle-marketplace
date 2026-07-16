\set ON_ERROR_STOP on

BEGIN;

INSERT INTO users(id,email,email_verified_at,display_name,selected_role)
VALUES('10000000-0000-4000-8000-000000000005','bootstrap-admin@invalid.example',now(),'Bootstrap Administrator','landlord');
INSERT INTO users(id,email,email_verified_at,display_name)
VALUES('10000000-0000-4000-8000-000000000006','bootstrap-unverified@invalid.example',NULL,'Unverified Bootstrap Attempt');
INSERT INTO authentication_identities(user_id,provider,provider_subject,provider_email,provider_email_verified)
VALUES('10000000-0000-4000-8000-000000000005','password','10000000-0000-4000-8000-000000000005','bootstrap-admin@invalid.example',true);
INSERT INTO authentication_identities(user_id,provider,provider_subject,provider_email,provider_email_verified)
VALUES('10000000-0000-4000-8000-000000000006','password','10000000-0000-4000-8000-000000000006','bootstrap-unverified@invalid.example',false);
INSERT INTO sessions(id,user_id,token_hash,csrf_secret_hash,expires_at) VALUES
  ('11000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000005',decode(repeat('35',32),'hex'),decode(repeat('45',32),'hex'),now()+interval '1 day'),
  ('11000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000005',decode(repeat('36',32),'hex'),decode(repeat('46',32),'hex'),now()+interval '1 day');

DO $test$
DECLARE first_result record; retry_result record;
BEGIN
  BEGIN
    PERFORM tideway_private.provision_bootstrap_administrator(
      'bootstrap-unverified@invalid.example','34000000-0000-4000-8000-000000000003','INTEGRATION-UNVERIFIED',
      'An unverified account must never receive Administrator authority.'
    );
    RAISE EXCEPTION 'Unverified account received Administrator authority';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM <> 'administrator-bootstrap-account-ineligible' THEN RAISE; END IF;
  END;
  IF EXISTS (SELECT 1 FROM user_roles WHERE user_id='10000000-0000-4000-8000-000000000006') THEN
    RAISE EXCEPTION 'Rejected unverified bootstrap left a role behind';
  END IF;

  SELECT * INTO first_result FROM tideway_private.provision_bootstrap_administrator(
    'bootstrap-admin@invalid.example','34000000-0000-4000-8000-000000000001','INTEGRATION-BOOTSTRAP-001',
    'Integration proof for first Administrator bootstrap and session revocation.'
  );
  IF first_result.provisioning_status <> 'provisioned' OR first_result.revoked_session_count <> 2 THEN
    RAISE EXCEPTION 'First Administrator result or session revocation count is incorrect';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM user_roles WHERE user_id='10000000-0000-4000-8000-000000000005' AND role='administrator' AND granted_by IS NULL) THEN
    RAISE EXCEPTION 'Bootstrap Administrator role or bootstrap grant evidence is missing';
  END IF;
  IF EXISTS (SELECT 1 FROM sessions WHERE user_id='10000000-0000-4000-8000-000000000005' AND revoked_at IS NULL) THEN
    RAISE EXCEPTION 'Bootstrap left an existing account session active';
  END IF;
  IF (SELECT count(*) FROM audit_logs WHERE action='administrator.bootstrap.provisioned' AND resource_id='10000000-0000-4000-8000-000000000005') <> 1 THEN
    RAISE EXCEPTION 'Bootstrap audit evidence is not exactly once';
  END IF;

  SELECT * INTO retry_result FROM tideway_private.provision_bootstrap_administrator(
    'bootstrap-admin@invalid.example','34000000-0000-4000-8000-000000000001','INTEGRATION-BOOTSTRAP-001',
    'Integration proof for first Administrator bootstrap and session revocation.'
  );
  IF retry_result.provisioning_status <> 'already-provisioned' OR retry_result.revoked_session_count <> 2 THEN
    RAISE EXCEPTION 'Exact bootstrap retry was not idempotent';
  END IF;

  BEGIN
    PERFORM tideway_private.provision_bootstrap_administrator(
      'bootstrap-admin@invalid.example','34000000-0000-4000-8000-000000000002','INTEGRATION-BOOTSTRAP-002',
      'A second bootstrap attempt must fail after one Administrator exists.'
    );
    RAISE EXCEPTION 'Second Administrator bootstrap was accepted';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'administrator-already-provisioned' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM tideway_private.provision_bootstrap_administrator(
      'bootstrap-admin@invalid.example','34000000-0000-4000-8000-000000000001','DIFFERENT-OPERATOR',
      'Changed retry material must not reuse the original request identifier.'
    );
    RAISE EXCEPTION 'Changed bootstrap retry material was accepted';
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'administrator-bootstrap-request-reused' THEN RAISE; END IF;
  END;
END
$test$;

DELETE FROM audit_logs WHERE resource_id='10000000-0000-4000-8000-000000000005';
DELETE FROM user_roles WHERE user_id='10000000-0000-4000-8000-000000000005';
DELETE FROM users WHERE id IN ('10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000006');

DO $test$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id IN ('10000000-0000-4000-8000-000000000005','10000000-0000-4000-8000-000000000006'))
     OR EXISTS (SELECT 1 FROM user_roles WHERE role='administrator')
     OR EXISTS (SELECT 1 FROM audit_logs WHERE metadata->>'requestId'='34000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Administrator bootstrap integration fixtures were not removed';
  END IF;
END
$test$;

COMMIT;
