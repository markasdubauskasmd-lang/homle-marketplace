\set ON_ERROR_STOP on
BEGIN;
SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config('app.user_roles', 'cleaner', true);
SELECT pg_sleep(0.5);
SELECT status FROM tideway_private.respond_to_cleaner_invitation('40000000-0000-4000-8000-000000000002', 'accept', NULL);
SELECT pg_sleep(1.5);
COMMIT;
