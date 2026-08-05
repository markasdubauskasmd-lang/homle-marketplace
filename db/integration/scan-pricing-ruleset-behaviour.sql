\set ON_ERROR_STOP on

BEGIN;

-- These numbers decide what customers are charged. The runtime role reaching
-- the table directly would let any future query rewrite the past, which is the
-- one thing an append-only rate history exists to prevent.
DO $privileges$
BEGIN
  IF has_table_privilege('tideway_app','public.scan_pricing_rulesets','SELECT')
    OR has_table_privilege('tideway_app','public.scan_pricing_rulesets','INSERT')
    OR has_table_privilege('tideway_app','public.scan_pricing_rulesets','UPDATE')
    OR has_table_privilege('tideway_app','public.scan_pricing_rulesets','DELETE')
  THEN RAISE EXCEPTION 'The runtime role can edit pricing rules directly'; END IF;
END
$privileges$;

INSERT INTO users (id, email, email_verified_at, display_name) VALUES
  ('1a000000-0000-4000-8000-000000000001','pricing-admin@invalid.example', now(), 'Pricing Administrator'),
  ('1a000000-0000-4000-8000-000000000002','pricing-landlord@invalid.example', now(), 'Pricing Landlord');
INSERT INTO user_roles (user_id, role) VALUES
  ('1a000000-0000-4000-8000-000000000001','administrator'),
  ('1a000000-0000-4000-8000-000000000002','landlord');

SELECT set_config('app.user_id','1a000000-0000-4000-8000-000000000002',true);
SELECT set_config('app.user_roles','landlord',true);
DO $landlord$
BEGIN
  BEGIN
    PERFORM tideway_private.publish_scan_pricing_ruleset('default','{}'::jsonb,'A Landlord should not be able to set prices.');
    RAISE EXCEPTION 'A Landlord published a pricing ruleset';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'administrator-required' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM tideway_private.list_scan_pricing_rulesets('default',20);
    RAISE EXCEPTION 'A Landlord read the internal rate history';
  EXCEPTION WHEN SQLSTATE '42501' THEN
    IF SQLERRM <> 'administrator-required' THEN RAISE; END IF;
  END;
  -- A customer is entitled to see the rates their own estimate was built from.
  PERFORM tideway_private.get_active_scan_pricing_ruleset('default');
END
$landlord$;

SELECT set_config('app.user_id','1a000000-0000-4000-8000-000000000001',true);
SELECT set_config('app.user_roles','administrator',true);
DO $administrator$
DECLARE first_version jsonb; second_version jsonb; live_count integer;
BEGIN
  -- A deployment that has never opened the administrator page must still price
  -- identically to one that has, by falling back to the shipped defaults.
  IF tideway_private.get_active_scan_pricing_ruleset('default') IS NOT NULL THEN
    RAISE EXCEPTION 'An unconfigured deployment reported a stored ruleset';
  END IF;

  first_version := tideway_private.publish_scan_pricing_ruleset('default',
    '{"minimumChargePence":4500,"hourlyRatePence":2800,"roomBasePence":400,"levelMultiplierBasisPoints":{"1":9000,"2":10000,"3":12500,"4":15000},"perSquareMetrePence":90,"baseRangeBasisPoints":1500,"unresolvedRangeBasisPointsEach":200,"maximumRangeBasisPoints":6000}'::jsonb,
    'Initial published rates for the scan estimate.');
  IF (first_version->>'version')::integer <> 1 THEN RAISE EXCEPTION 'The first publication was not version 1'; END IF;
  -- Specialist review must stay unpriceable whatever an operator submits.
  IF (first_version->'levelMultiplierBasisPoints'->>'5')::integer <> 0 THEN
    RAISE EXCEPTION 'A published ruleset put a price on specialist review';
  END IF;

  second_version := tideway_private.publish_scan_pricing_ruleset('default',
    '{"minimumChargePence":5000,"hourlyRatePence":3000,"roomBasePence":400,"levelMultiplierBasisPoints":{"1":9000,"2":10000,"3":12500,"4":15000},"perSquareMetrePence":90,"baseRangeBasisPoints":1500,"unresolvedRangeBasisPointsEach":200,"maximumRangeBasisPoints":6000}'::jsonb,
    'Raised the hourly rate after the spring review.');
  IF (second_version->>'version')::integer <> 2 OR (second_version->>'hourlyRatePence')::integer <> 3000 THEN
    RAISE EXCEPTION 'Republishing did not create a new live version';
  END IF;

  -- Exactly one live version, enforced by the database rather than convention:
  -- two would price identical scans differently depending on row order.
  SELECT count(*) INTO live_count FROM scan_pricing_rulesets WHERE ruleset_id='default' AND retired_at IS NULL;
  IF live_count <> 1 THEN RAISE EXCEPTION 'More than one live ruleset survived a republish'; END IF;
  -- Append-only: an estimate produced last month must still be recomputable
  -- from exactly the rules that produced it.
  IF (SELECT count(*) FROM scan_pricing_rulesets WHERE ruleset_id='default') <> 2 THEN
    RAISE EXCEPTION 'The superseded ruleset was destroyed rather than retired';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action='scan-pricing-ruleset-published') THEN
    RAISE EXCEPTION 'A change to what every customer is charged was not audited';
  END IF;
  IF jsonb_array_length(tideway_private.list_scan_pricing_rulesets('default',20)->'versions') <> 2 THEN
    RAISE EXCEPTION 'The rate history lost a version';
  END IF;

  -- A typo in a web form must fail loudly rather than price a thousand jobs at
  -- ten times the intended rate.
  BEGIN
    PERFORM tideway_private.publish_scan_pricing_ruleset('default',
      '{"minimumChargePence":4500,"hourlyRatePence":999999,"roomBasePence":400,"levelMultiplierBasisPoints":{"1":9000,"2":10000,"3":12500,"4":15000},"perSquareMetrePence":90,"baseRangeBasisPoints":1500,"unresolvedRangeBasisPointsEach":200,"maximumRangeBasisPoints":6000}'::jsonb,
      'An out-of-range rate must be refused.');
    RAISE EXCEPTION 'An absurd hourly rate was published';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'invalid-pricing-ruleset' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM tideway_private.publish_scan_pricing_ruleset('default','{"hourlyRatePence":2800}'::jsonb,'Too short');
    RAISE EXCEPTION 'A rate change with no stated reason was published';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'invalid-pricing-ruleset' THEN RAISE; END IF;
  END;

  -- A refused publication must not leave the deployment with nothing live. The
  -- retiring UPDATE runs before the INSERT, so if the INSERT is rejected the
  -- whole call has to unwind — otherwise one bad form submission silently
  -- reverts every estimate to the shipped defaults.
  SELECT count(*) INTO live_count FROM scan_pricing_rulesets WHERE ruleset_id='default' AND retired_at IS NULL;
  IF live_count <> 1 THEN RAISE EXCEPTION 'A refused rate change left the deployment with no live ruleset'; END IF;
  IF (tideway_private.get_active_scan_pricing_ruleset('default')->>'version')::integer <> 2 THEN
    RAISE EXCEPTION 'A refused rate change disturbed the live ruleset';
  END IF;
END
$administrator$;

ROLLBACK;
