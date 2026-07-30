\set ON_ERROR_STOP on

BEGIN;

INSERT INTO properties (id,landlord_user_id,name,address_line_1,locality,postcode,property_type) VALUES
  ('21000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Archiveable fixture','Private archive address A','London','SW1A 1AA','flat'),
  ('21000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Active request fixture','Private archive address B','London','SW1A 1AA','flat'),
  ('21000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','Active booking fixture','Private archive address C','London','SW1A 1AA','flat'),
  ('21000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','Completed history fixture','Private archive address D','London','SW1A 1AA','flat');

INSERT INTO cleaning_requests (
  id,landlord_user_id,property_id,status,requested_start_at,requested_end_at,
  cleaning_type,required_services,budget_pence
) VALUES (
  '31000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  '21000000-0000-4000-8000-000000000002','draft',now()+interval '7 days',
  now()+interval '7 days 2 hours','standard',ARRAY['standard-clean'],10000
);

INSERT INTO bookings (
  id,landlord_user_id,cleaner_user_id,property_id,status,scheduled_start_at,
  scheduled_end_at,customer_price_pence,cleaner_pay_pence,confirmed_at
) VALUES
  ('41000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000003','confirmed',now()+interval '8 days',now()+interval '8 days 2 hours',10000,7000,now()),
  ('41000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','21000000-0000-4000-8000-000000000004','completed',now()-interval '8 days',now()-interval '8 days'+interval '2 hours',10000,7000,now()-interval '9 days');

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000002',true);
SELECT set_config('app.user_roles','cleaner',true);
DO $$
BEGIN
  PERFORM tideway_private.archive_my_property('21000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'A Cleaner archived a Landlord property';
EXCEPTION WHEN insufficient_privilege THEN
  IF SQLERRM<>'landlord-required' THEN RAISE; END IF;
END $$;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000003',true);
SELECT set_config('app.user_roles','landlord',true);
DO $$
BEGIN
  PERFORM tideway_private.archive_my_property('21000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'An unrelated Landlord archived another account property';
EXCEPTION WHEN no_data_found THEN
  IF SQLERRM<>'property-not-found' THEN RAISE; END IF;
END $$;

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('app.user_roles','landlord,cleaner',true);
DO $$
BEGIN
  PERFORM tideway_private.archive_my_property('21000000-0000-4000-8000-000000000002');
  RAISE EXCEPTION 'A property with an active cleaning request was archived';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'property-has-active-request' THEN RAISE; END IF;
END $$;
DO $$
BEGIN
  PERFORM tideway_private.archive_my_property('21000000-0000-4000-8000-000000000003');
  RAISE EXCEPTION 'A property with an active booking was archived';
EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'property-has-active-booking' THEN RAISE; END IF;
END $$;

SELECT tideway_private.archive_my_property('21000000-0000-4000-8000-000000000001');
SELECT tideway_private.archive_my_property('21000000-0000-4000-8000-000000000004');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM properties
    WHERE id IN ('21000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000004')
      AND archived_at IS NULL
  ) THEN RAISE EXCEPTION 'Archived properties remained active'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM bookings
    WHERE id='41000000-0000-4000-8000-000000000002' AND status='completed'
  ) THEN RAISE EXCEPTION 'Archiving erased completed booking history'; END IF;
  IF (
    SELECT count(*) FROM audit_logs
    WHERE action='property-archived'
      AND resource_id IN ('21000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000004')
      AND actor_user_id='10000000-0000-4000-8000-000000000001'
  )<>2 THEN RAISE EXCEPTION 'Property archive audit evidence is missing or duplicated'; END IF;
  IF EXISTS (
    SELECT 1 FROM audit_logs
    WHERE action='property-archived'
      AND resource_id IN ('21000000-0000-4000-8000-000000000001','21000000-0000-4000-8000-000000000004')
      AND (metadata ? 'address' OR metadata ? 'name' OR jsonb_object_length(metadata)<>1 OR NOT metadata ? 'archivedAt')
  ) THEN RAISE EXCEPTION 'Property archive audit evidence exposed private property data'; END IF;
  IF NOT has_function_privilege('tideway_app','tideway_private.archive_my_property(uuid)','EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM pg_proc procedure,
            LATERAL aclexplode(COALESCE(procedure.proacl,acldefault('f',procedure.proowner))) privilege
       WHERE procedure.oid=to_regprocedure('tideway_private.archive_my_property(uuid)')
         AND privilege.grantee=0
         AND privilege.privilege_type='EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Property archive execution privilege is missing or public';
  END IF;
END $$;

ROLLBACK;
