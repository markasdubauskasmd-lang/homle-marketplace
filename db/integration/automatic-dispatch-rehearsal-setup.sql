\set ON_ERROR_STOP on

BEGIN;

INSERT INTO users (id,email,email_verified_at,display_name,selected_role)
VALUES ('10000000-0000-4000-8000-000000000005','integration-dispatch-cleaner@invalid.example',now(),'Integration Dispatch Cleaner','cleaner');
INSERT INTO user_roles (user_id,role)
VALUES ('10000000-0000-4000-8000-000000000005','cleaner');
INSERT INTO cleaner_profiles (
  user_id,public_slug,biography,hourly_rate_pence,travel_radius_km,years_experience,languages,
  equipment_supplied,products_supplied,profile_completion_percent,current_availability_status,is_public
) VALUES (
  '10000000-0000-4000-8000-000000000005','integration-dispatch-cleaner-test','Non-public automatic-dispatch fixture.',
  2600,10,1,ARRAY['English'],ARRAY['Vacuum'],ARRAY['General cleaner'],100,'available',true
);
INSERT INTO cleaner_services (cleaner_user_id,service_code,pricing_model,price_pence)
VALUES ('10000000-0000-4000-8000-000000000005','standard-clean','hourly',2600);
INSERT INTO cleaner_service_areas (cleaner_user_id,outward_postcode)
VALUES ('10000000-0000-4000-8000-000000000005','SW1A');
INSERT INTO cleaner_availability (id,cleaner_user_id,starts_at,ends_at,status) VALUES
  ('75000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',now()+interval '53 hours',now()+interval '57 hours','available'),
  ('75000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000005',now()+interval '53 hours',now()+interval '57 hours','available');

INSERT INTO properties (id,landlord_user_id,name,address_line_1,locality,postcode,property_type,access_instructions_ciphertext)
VALUES ('20000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','Integration Dispatch Property','Private dispatch test address','London','SW1A 1AA','flat',decode('0a0b0c','hex'));
INSERT INTO cleaning_requests (
  id,landlord_user_id,property_id,status,requested_start_at,requested_end_at,cleaning_type,
  required_services,budget_pence,scope_fingerprint,submitted_at
) VALUES (
  '30000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000004','draft',now()+interval '54 hours',now()+interval '56 hours',
  'standard',ARRAY['standard-clean'],10000,repeat('d',64),NULL
);
INSERT INTO cleaning_request_tasks (cleaning_request_id,room_name,description,sort_order)
VALUES ('30000000-0000-4000-8000-000000000004','Living room','Vacuum floor',0);
INSERT INTO cleaning_request_photos (
  id,cleaning_request_id,storage_key,room_name,note,mime_type,byte_size,checksum_sha256,width_pixels,height_pixels,sanitized_at
) VALUES (
  '60000000-0000-4000-8000-000000000006','30000000-0000-4000-8000-000000000004',
  'request-photos/30000000-0000-4000-8000-000000000004/60000000-0000-4000-8000-000000000006.jpg',
  'Living room','Synthetic automatic-dispatch room photo','image/jpeg',1000,decode(repeat('cd',32),'hex'),800,600,now()
);

SELECT set_config('app.user_id','10000000-0000-4000-8000-000000000001',true);
SELECT set_config('app.user_roles','landlord',true);
SELECT tideway_private.submit_cleaning_request('30000000-0000-4000-8000-000000000004',true,false);

DO $$
DECLARE result jsonb;
BEGIN
  SELECT tideway_private.configure_automatic_dispatch('30000000-0000-4000-8000-000000000004',true,2::smallint) INTO result;
  IF result->>'enabled'<>'true' OR (result->>'attemptLimit')::integer<>2 OR (result->>'attemptCount')::integer<>0 THEN
    RAISE EXCEPTION 'Automatic-dispatch rehearsal authorization was not stored exactly';
  END IF;
END
$$;

COMMIT;
