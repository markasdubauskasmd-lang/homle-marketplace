\ir payment-claim-concurrency-core.sql
\pset tuples_only on
\pset format unaligned
SELECT 'PAYMENT_CLAIM_A|'||pg_temp.claim_fixture()::text;
SELECT pg_advisory_lock(113471,1);
-- Do not release the payment lock until the other real connection is blocked.
DO $barrier$
DECLARE deadline timestamptz:=clock_timestamp()+interval '8 seconds';
BEGIN
 LOOP
   EXIT WHEN EXISTS(SELECT 1 FROM pg_locks marker JOIN pg_locks waiting ON waiting.pid=marker.pid
     WHERE marker.locktype='advisory' AND marker.classid=113471 AND marker.objid=2 AND marker.objsubid=2
       AND marker.granted AND NOT waiting.granted AND waiting.locktype IN ('transactionid','tuple'));
   IF clock_timestamp()>=deadline THEN RAISE EXCEPTION 'Second payment claim did not actually wait for the first transaction'; END IF;
   PERFORM pg_sleep(0.01);
 END LOOP;
END;
$barrier$;
COMMIT;
SELECT pg_advisory_unlock_all();
