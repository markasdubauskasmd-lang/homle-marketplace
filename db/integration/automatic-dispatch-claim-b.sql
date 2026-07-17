\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
BEGIN;
SELECT 'AUTOMATIC_DISPATCH_CLAIM_B|'||count(*)::text
FROM tideway_private.claim_due_automatic_dispatch('74000000-0000-4000-8000-000000000002',1,120);
SELECT pg_sleep(1.5);
COMMIT;
