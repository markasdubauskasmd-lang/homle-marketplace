-- The price a customer was shown, frozen onto the request that showed it.
--
-- Until now the customer price was discovered at invitation time, by
-- booking-workflow quote() binary-searching whichever cleaner was being invited
-- against a target margin. That works, but it means no price can exist before a
-- cleaner does — which is why the scanner could only ever show an estimate.
--
-- These columns hold the quote the customer actually saw. When they are present,
-- the customer price is already decided and the cleaner is paid a share of it;
-- when they are absent, quote() prices the request exactly as it does today.
-- Both paths stay live on purpose: a request built from a cleaner's own rates,
-- or one needing a manual quote, still has no platform price to freeze.
--
--   * **Frozen, not recomputed.** A booking made in March must still charge the
--     March price even after an operator publishes new rates in April. The
--     total is stored, and pricing_config_version records which price list
--     produced it so the figure can be explained rather than merely trusted.
--
--   * **Nullable.** Every existing request predates this and must keep working.
--     A NOT NULL default would have silently given historic requests a price
--     nobody quoted them.
--
--   * **Bounded.** A quote outside these bounds is a bug, not an expensive
--     clean, and it should fail at the write rather than at the card.

BEGIN;

ALTER TABLE cleaning_requests
  ADD COLUMN quoted_total_pence integer
    CHECK (quoted_total_pence IS NULL OR quoted_total_pence BETWEEN 1 AND 10000000),
  -- The visit length the price was built from, so the cleaner is told the same
  -- duration the customer paid for.
  ADD COLUMN quoted_minutes integer
    CHECK (quoted_minutes IS NULL OR quoted_minutes BETWEEN 1 AND 10080),
  ADD COLUMN pricing_config_version integer
    CHECK (pricing_config_version IS NULL OR pricing_config_version BETWEEN 1 AND 100000),
  ADD COLUMN quoted_at timestamptz;

-- All four travel together or none do. A total with no version cannot be
-- explained later, and a version with no total prices nothing.
ALTER TABLE cleaning_requests
  ADD CONSTRAINT cleaning_requests_quote_complete CHECK (
    (quoted_total_pence IS NULL AND quoted_minutes IS NULL AND pricing_config_version IS NULL AND quoted_at IS NULL)
    OR (quoted_total_pence IS NOT NULL AND quoted_minutes IS NOT NULL AND pricing_config_version IS NOT NULL AND quoted_at IS NOT NULL)
  );

COMMIT;
