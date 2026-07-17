\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

DO $bootstrap_guard$
DECLARE
  selected_role record;
  application_table_count integer;
BEGIN
  IF current_setting('server_version_num')::integer < 160000 THEN
    RAISE EXCEPTION 'Homle staging bootstrap requires PostgreSQL 16 or newer';
  END IF;
  IF current_database() !~* '_(tideway|homle)_staging$' THEN
    RAISE EXCEPTION 'Homle staging database name must end in _tideway_staging or _homle_staging';
  END IF;
  IF current_user IN ('tideway_app', 'tideway_worker') THEN
    RAISE EXCEPTION 'Homle staging bootstrap requires a separate migration-owner account';
  END IF;

  FOR selected_role IN
    SELECT rolname, rolcanlogin, rolsuper, rolbypassrls FROM pg_roles
    WHERE rolname IN ('tideway_app', 'tideway_worker')
  LOOP
    IF NOT selected_role.rolcanlogin OR selected_role.rolsuper OR selected_role.rolbypassrls THEN
      RAISE EXCEPTION 'Restricted role % must login without superuser or BYPASSRLS', selected_role.rolname;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_roles WHERE rolname IN ('tideway_app', 'tideway_worker')) <> 2 THEN
    RAISE EXCEPTION 'Create separate safe tideway_app and tideway_worker login roles before bootstrap';
  END IF;

  SELECT count(*) INTO application_table_count
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname IN ('public', 'tideway_private')
    AND relation.relkind IN ('r', 'p', 'v', 'm', 'S');
  IF application_table_count <> 0 THEN
    RAISE EXCEPTION 'Homle staging bootstrap refuses a database containing public or tideway_private relations';
  END IF;
END
$bootstrap_guard$;

ROLLBACK;
