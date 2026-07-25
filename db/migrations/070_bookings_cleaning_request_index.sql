-- Indexes bookings(cleaning_request_id) for the general lookup.
--
-- bookings_one_live_attempt_per_request_idx already covers this column, but it is
-- a PARTIAL unique index:
--
--   ON bookings(cleaning_request_id)
--   WHERE cleaning_request_id IS NOT NULL AND status <> 'cancelled'
--
-- PostgreSQL will only use a partial index for a query whose own predicate implies
-- the index predicate. Several lookups deliberately do NOT filter out cancelled
-- bookings, so none of them can use it and each one sequentially scans bookings:
--
--   * the automatic-dispatch attempt-limit count, which must count every prior
--     attempt including cancelled ones — that is the whole point of the limit;
--   * the check for whether a candidate Cleaner already has a prior booking on
--     this request, which runs once per candidate per dispatch round;
--   * the plain "bookings for this request" lookups.
--
-- Those run on the dispatch path against a table that grows without bound, so the
-- cost rises with total booking history rather than with the request being
-- dispatched.
--
-- This index is deliberately NOT unique and deliberately keeps only the
-- IS NOT NULL predicate: uniqueness is already enforced where it belongs by the
-- existing partial index, and `cleaning_request_id = $1` implies IS NOT NULL, so
-- the planner can still use this one while it stays small by excluding bookings
-- created without a request.
--
-- CREATE INDEX rather than CREATE INDEX CONCURRENTLY because every migration here
-- runs inside a transaction and CONCURRENTLY cannot. At this table's size the
-- brief lock is not worth splitting the migration model for.

BEGIN;

CREATE INDEX IF NOT EXISTS bookings_cleaning_request_idx
  ON bookings(cleaning_request_id)
  WHERE cleaning_request_id IS NOT NULL;

COMMIT;
