-- Proves tideway_private.list_cleaner_verification_queue actually paginates.
--
-- Migration 063 applied LIMIT/OFFSET to a select list consisting of a single
-- jsonb_agg call. An aggregate over a non-grouped query yields exactly one row,
-- so the LIMIT and OFFSET applied to that row rather than to the cleaners being
-- aggregated: page 1 returned the entire queue whatever limit was asked for, and
-- every later page returned '[]'. Migration 069 slices before aggregating.
--
-- Read-only, and it mutates nothing: two Cleaner profiles already exist in the
-- integration fixtures, which is all this needs. Asking for one per page with two
-- available rows is the sharpest discriminator there is — under the old function
-- the very first assertion below fails, because page 1 comes back holding both.

\set ON_ERROR_STOP on

BEGIN TRANSACTION READ ONLY;

SELECT set_config('app.user_id', '10000000-0000-4000-8000-000000000004', true);
SELECT set_config('app.user_roles', 'administrator', true);

DO $cleaner_verification_queue_pagination$
DECLARE
  everything jsonb;
  first_page jsonb;
  second_page jsonb;
  total integer;
BEGIN
  everything := tideway_private.list_cleaner_verification_queue('all', 100, 0);
  total := jsonb_array_length(everything->'cleaners');

  -- Guard the guard: with fewer than two Cleaners the pagination assertions below
  -- would pass against the broken function too, and this file would silently stop
  -- testing anything.
  IF total < 2 THEN
    RAISE EXCEPTION 'The verification queue holds % Cleaner(s); this scenario needs at least 2 to tell real pagination from the aggregate bug', total;
  END IF;

  first_page := tideway_private.list_cleaner_verification_queue('all', 1, 0);
  IF jsonb_array_length(first_page->'cleaners') <> 1 THEN
    RAISE EXCEPTION 'Cleaner verification queue ignored its page limit: asked for 1, received %. LIMIT is being applied to the aggregate row rather than to the Cleaners.', jsonb_array_length(first_page->'cleaners');
  END IF;

  second_page := tideway_private.list_cleaner_verification_queue('all', 1, 1);
  IF jsonb_array_length(second_page->'cleaners') <> 1 THEN
    RAISE EXCEPTION 'Cleaner verification queue returned % row(s) on page 2 of %; an Administrator paging forward sees nothing because OFFSET skipped the single aggregate row.', jsonb_array_length(second_page->'cleaners'), total;
  END IF;

  -- Pages must not overlap. Ordering that is not total would let a Cleaner appear
  -- on both pages while another appeared on neither, which is why the function
  -- orders by updated_at DESC then user_id rather than updated_at alone.
  IF first_page->'cleaners'->0->>'cleanerId' = second_page->'cleaners'->0->>'cleanerId' THEN
    RAISE EXCEPTION 'Pages 1 and 2 of the Cleaner verification queue returned the same Cleaner, so the ordering is not total and Cleaners can be shown twice or skipped entirely';
  END IF;

  -- The window reported back to the caller has to describe the window actually
  -- returned, or the client cannot tell whether more pages exist.
  IF (first_page->>'limit')::integer <> 1 OR (first_page->>'offset')::integer <> 0
     OR (second_page->>'limit')::integer <> 1 OR (second_page->>'offset')::integer <> 1 THEN
    RAISE EXCEPTION 'The Cleaner verification queue misreported the page window it returned';
  END IF;

  -- Past the end must be empty rather than wrapping back to the start.
  IF jsonb_array_length(tideway_private.list_cleaner_verification_queue('all', 100, 10000)->'cleaners') <> 0 THEN
    RAISE EXCEPTION 'An offset beyond the end of the Cleaner verification queue returned rows';
  END IF;

  -- The validation carried over from 063 must still hold.
  BEGIN
    PERFORM tideway_private.list_cleaner_verification_queue('all', 0, 0);
    RAISE EXCEPTION 'A zero page limit was accepted by the Cleaner verification queue';
  EXCEPTION WHEN data_exception THEN NULL;
  END;
  BEGIN
    PERFORM tideway_private.list_cleaner_verification_queue('not-a-view', 10, 0);
    RAISE EXCEPTION 'An unknown view was accepted by the Cleaner verification queue';
  EXCEPTION WHEN data_exception THEN NULL;
  END;
END
$cleaner_verification_queue_pagination$;

-- Still Administrator-only after the replacement.
SELECT set_config('app.user_roles', 'landlord', true);

DO $cleaner_verification_queue_role$
BEGIN
  BEGIN
    PERFORM tideway_private.list_cleaner_verification_queue('all', 10, 0);
    RAISE EXCEPTION 'A Landlord read the Administrator Cleaner verification queue';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$cleaner_verification_queue_role$;

ROLLBACK;
