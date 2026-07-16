\set ON_ERROR_STOP on

DO $test$
BEGIN
  BEGIN
    PERFORM tideway_private.provision_bootstrap_administrator(
      'bootstrap-denied@invalid.example',
      '34000000-0000-4000-8000-000000000001',
      'INTEGRATION-DENIAL',
      'Restricted runtime role must never provision an Administrator.'
    );
    RAISE EXCEPTION 'Runtime role provisioned an Administrator';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$test$;
