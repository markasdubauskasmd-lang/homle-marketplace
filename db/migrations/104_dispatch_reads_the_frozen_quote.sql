-- Automatic dispatch stops pricing, and starts reading the price.
--
-- Until now the dispatch worker priced every candidate cost-up, from the
-- invited cleaner's own rate card, through the twelve BOOKING_* environment
-- variables. That was the third of the three pricing systems the August 2026
-- audit found, and it is the last consumer of it.
--
-- Two problems with it, and the second is the serious one:
--
--   * It ranked cleaners by the price each one produced, awarding the cheapest
--     a quarter of the match score. Under platform pricing the customer price is
--     the same whoever cleans, so that term ranks nothing — it just adds noise
--     to a decision about who is best for the job.
--
--   * It meant a customer could be shown one number by the pricing engine and
--     then automatically booked at another. The whole point of freezing a quote
--     onto the request is that the number survives to the card.
--
-- After this the worker invites at the frozen total and pays the cleaner the
-- published share of it — the same arithmetic quoteEconomics() applies
-- everywhere else, in one implementation, in JavaScript. Nothing here computes
-- money; it only carries the numbers the worker needs to reach it.

BEGIN;

/* ── The frozen quote, on every dispatch candidate ──────────────────────── */

-- Same name, same signature, same SETOF jsonb: only the contents of each row
-- grow. The request record is already in scope, so this is a merge rather than
-- a second query.
--
-- A request with no frozen quote yields NULLs, and the worker skips it rather
-- than pricing it some other way. An automatic booking made at a number nobody
-- has shown the customer is exactly what this change exists to stop.
CREATE OR REPLACE FUNCTION tideway_private.get_automatic_dispatch_candidates(
  target_request_id uuid,
  lease_token uuid,
  result_limit integer,
  require_payout_ready boolean
)
RETURNS SETOF jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE request_record cleaning_requests%ROWTYPE; candidate_record record;
BEGIN
  IF lease_token IS NULL OR result_limit IS NULL OR result_limit NOT BETWEEN 1 AND 50 OR require_payout_ready IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-automatic-dispatch-candidate-request';
  END IF;
  SELECT * INTO request_record FROM cleaning_requests request
    WHERE request.id=target_request_id AND request.status='searching-for-cleaner'
      AND request.automatic_dispatch_authorized_at IS NOT NULL AND request.automatic_dispatch_revoked_at IS NULL
      AND request.automatic_dispatch_lease_token=lease_token AND request.automatic_dispatch_lease_expires_at>now();
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='automatic-dispatch-lease-not-found'; END IF;
  PERFORM set_config('app.user_id',request_record.landlord_user_id::text,true);
  PERFORM set_config('app.user_roles','landlord',true);
  FOR candidate_record IN
    SELECT candidate.* FROM tideway_private.recommend_cleaners_for_request_v3(request_record.id,50,require_payout_ready) candidate
    WHERE NOT EXISTS (
      SELECT 1 FROM bookings prior WHERE prior.cleaning_request_id=request_record.id AND prior.cleaner_user_id=candidate.cleaner_id
    )
    LIMIT result_limit
  LOOP
    RETURN NEXT to_jsonb(candidate_record) || jsonb_build_object(
      'quoted_total_pence', request_record.quoted_total_pence,
      'quoted_minutes', request_record.quoted_minutes,
      'pricing_config_version', request_record.pricing_config_version
    );
  END LOOP;
  RETURN;
END;
$$;

/* ── The platform's own share, for the worker ───────────────────────────── */

-- The worker has no signed-in user, so it cannot go through the reader the
-- request path uses. It still needs the cleaner's share to turn a frozen total
-- into a payout, and computing that share in SQL would make this a second place
-- the split is defined.
--
-- So this returns the stored economics UNCHANGED and does no arithmetic. The
-- split stays in pricing-economics.mjs, in one implementation, and this
-- function is a read.
--
-- Deliberately narrow: it returns only the active configuration's economics,
-- takes no arguments, and is granted to the worker role alone. There is no user
-- to authorise because there is no user — which is why it must never be granted
-- to tideway_app, whose callers do have one and whose reader already checks it.
CREATE FUNCTION tideway_private.get_worker_pricing_economics()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
  SELECT economics FROM pricing_configurations
   WHERE config_id='default' AND retired_at IS NULL
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION tideway_private.get_worker_pricing_economics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tideway_private.get_worker_pricing_economics() TO tideway_worker;

COMMIT;
