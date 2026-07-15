-- Run as the migration owner after creating a role named tideway_app.
-- Supply its password through the deployment secret manager, never in this file.
BEGIN;

DO $$
DECLARE
  runtime_role record;
BEGIN
  SELECT rolsuper, rolbypassrls INTO runtime_role FROM pg_roles WHERE rolname = 'tideway_app';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Create the restricted tideway_app role before applying runtime grants';
  END IF;
  IF runtime_role.rolsuper OR runtime_role.rolbypassrls THEN
    RAISE EXCEPTION 'tideway_app must not be a superuser and must not bypass row-level security';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public, tideway_private TO tideway_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tideway_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tideway_app;

GRANT EXECUTE ON FUNCTION tideway_private.lookup_password_account(citext) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.lookup_session(bytea) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.lookup_verified_email(citext) TO tideway_app;

COMMIT;
