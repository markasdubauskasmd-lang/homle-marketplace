-- Two indexes for query shapes the existing indexes cannot serve.
--
-- Both of these were dismissed in the commit for migration 070 as "already
-- covered" and "primary-key lookups". That was wrong: the check behind those
-- dismissals looked at the wrong function in each case. Re-reading the actual
-- query bodies shows both are real. The record is corrected here rather than
-- quietly, because the earlier note said they needed no work.
--
--
-- 1. payment_commands(payment_id, command_kind, created_at DESC)
--
-- list_administrator_payment_operations runs FOUR correlated subqueries per
-- payment row, one per command kind:
--
--   SELECT command.status FROM payment_commands command
--   WHERE command.payment_id = payment.id AND command.command_kind = 'capture'
--   ORDER BY command.created_at DESC LIMIT 1
--
-- The existing indexes on this table are partial uniques of the form
--   ON payment_commands(payment_id) WHERE command_kind='capture' AND status <> 'provider-failed'
-- and the query above has NO status predicate, so it does not imply the index
-- predicate and the index cannot be used. Every one of those subqueries falls back
-- to a sequential scan, at a page size of up to 100 payments — up to 400 scans of
-- payment_commands to render one Administrator payment page.
--
-- The earlier dismissal noted that `idempotency_key_hash` is UNIQUE and therefore
-- indexed. True, and irrelevant: none of these four subqueries look it up.
--
-- created_at DESC is part of the index so the ORDER BY ... LIMIT 1 is answered by
-- reading the first matching entry rather than sorting the group.
--
--
-- 2. cleaner_profiles WHERE is_public AND profile_completion_percent = 100
--
-- search_cleaner_directory is reachable unauthenticated, and cleaner_profiles has
-- no index at all beyond its primary key, so every directory search scans the
-- whole table. Its two always-applied predicates are exactly the pair below;
-- every other filter in that query is NULL-guarded and therefore optional, which
-- is what makes a partial index on just these two correct.
--
-- The earlier dismissal checked get_public_cleaner_profile, which really is a
-- primary-key lookup — but that is the single-profile route, not the directory.
--
-- The ORDER BY is on computed expressions, so a sort still happens; it just
-- happens over the publishable subset instead of over every profile ever created.

BEGIN;

CREATE INDEX IF NOT EXISTS payment_commands_latest_by_kind_idx
  ON payment_commands(payment_id, command_kind, created_at DESC);

CREATE INDEX IF NOT EXISTS cleaner_profiles_public_directory_idx
  ON cleaner_profiles(user_id)
  WHERE is_public AND profile_completion_percent = 100;

COMMIT;
