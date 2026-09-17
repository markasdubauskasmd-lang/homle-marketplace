\ir payment-claim-concurrency-core.sql
DO $barrier$
DECLARE deadline timestamptz:=clock_timestamp()+interval '8 seconds';
BEGIN
 LOOP
   EXIT WHEN EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND classid=113471 AND objid=1 AND objsubid=2 AND granted);
   IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'First payment claim never acquired its fixture lock'; END IF;
   PERFORM pg_sleep(0.01);
 END LOOP;
END;
$barrier$;
SELECT pg_advisory_lock(113471,2);
\pset tuples_only on
\pset format unaligned
SELECT 'PAYMENT_CLAIM_B|'||pg_temp.claim_fixture()::text;
COMMIT;
SELECT pg_advisory_unlock_all();
