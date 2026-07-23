\set ON_ERROR_STOP on

BEGIN;

SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000001', true);
SELECT set_config('app.user_roles', 'landlord', true);

DO $payout_unready$
DECLARE
  unpaid_cleaners uuid[];
  paid_cleaners uuid[];
  paid_projection text;
BEGIN
  IF tideway_private.cleaner_payout_ready_for_paid_booking('10000000-0000-4000-8000-000000000002') IS TRUE THEN
    RAISE EXCEPTION 'A Cleaner without provider-verified payout setup was marked ready for paid booking';
  END IF;

  SELECT COALESCE(array_agg(candidate.cleaner_id), ARRAY[]::uuid[])
  INTO unpaid_cleaners
  FROM tideway_private.recommend_cleaners_for_request_v3(
    '30000000-0000-4000-8000-000000000003',
    25,
    false
  ) candidate;

  SELECT COALESCE(array_agg(candidate.cleaner_id), ARRAY[]::uuid[]),
         COALESCE(jsonb_agg(to_jsonb(candidate)), '[]'::jsonb)::text
  INTO paid_cleaners, paid_projection
  FROM tideway_private.recommend_cleaners_for_request_v3(
    '30000000-0000-4000-8000-000000000003',
    25,
    true
  ) candidate;

  IF NOT ('10000000-0000-4000-8000-000000000002'::uuid = ANY(unpaid_cleaners)) THEN
    RAISE EXCEPTION 'No-payment matching incorrectly required Cleaner payout setup';
  END IF;
  IF '10000000-0000-4000-8000-000000000002'::uuid = ANY(paid_cleaners) THEN
    RAISE EXCEPTION 'Paid matching included a Cleaner without provider-verified payout setup';
  END IF;
  IF paid_projection ~* '(payout|destination_account|provider_account|bank)' THEN
    RAISE EXCEPTION 'Paid matching exposed private payout or banking material';
  END IF;
END
$payout_unready$;

SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000002', true);
SELECT set_config('app.user_roles', 'cleaner', true);

DO $cleaner_denied$
BEGIN
  BEGIN
    PERFORM tideway_private.cleaner_payout_ready_for_paid_booking(
      '10000000-0000-4000-8000-000000000002'
    );
    RAISE EXCEPTION 'A Cleaner could inspect the paid-booking payout-readiness boundary';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'landlord-required' THEN RAISE; END IF;
  END;
END
$cleaner_denied$;

SELECT tideway_private.begin_my_cleaner_payout_onboarding(
  '72000000-0000-4000-8000-000000000011'
);
SELECT tideway_private.attach_my_cleaner_payout_account(
  '72000000-0000-4000-8000-000000000011',
  'acct_paid_matching_rehearsal'
);
SELECT tideway_private.sync_my_cleaner_payout_account(
  'acct_paid_matching_rehearsal',
  false,
  true,
  true
);

SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000001', true);
SELECT set_config('app.user_roles', 'landlord', true);

DO $payout_ready$
DECLARE
  paid_cleaners uuid[];
  paid_projection text;
BEGIN
  IF tideway_private.cleaner_payout_ready_for_paid_booking('10000000-0000-4000-8000-000000000002') IS NOT TRUE THEN
    RAISE EXCEPTION 'Provider-verified Cleaner payout setup did not unlock paid matching';
  END IF;

  SELECT COALESCE(array_agg(candidate.cleaner_id), ARRAY[]::uuid[]),
         COALESCE(jsonb_agg(to_jsonb(candidate)), '[]'::jsonb)::text
  INTO paid_cleaners, paid_projection
  FROM tideway_private.recommend_cleaners_for_request_v3(
    '30000000-0000-4000-8000-000000000003',
    25,
    true
  ) candidate;

  IF NOT ('10000000-0000-4000-8000-000000000002'::uuid = ANY(paid_cleaners)) THEN
    RAISE EXCEPTION 'Provider-verified Cleaner was missing from paid matching';
  END IF;
  IF paid_projection ~* '(payout|destination_account|provider_account|bank)' THEN
    RAISE EXCEPTION 'Paid matching exposed private payout or banking material';
  END IF;
END
$payout_ready$;

ROLLBACK;
