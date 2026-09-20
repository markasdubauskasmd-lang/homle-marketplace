-- Count the cleaner recruitment page in the funnel.
--
-- Cleaner supply is the constraint that blocks every booking: with nobody to
-- match, nothing else in the product matters. The new /for-cleaners page is
-- the first real pitch that audience has had, so whether it converts is one of
-- the few numbers currently worth watching -- and migration 124's `surface`
-- list is a CHECK constraint, so an uncounted page is silently dropped rather
-- than noticed.
--
-- The vocabulary is restated in full because the constraint is replaced
-- wholesale. Every other value is unchanged from migration 124.

BEGIN;

ALTER TABLE tideway_private.public_funnel_hourly DROP CONSTRAINT public_funnel_surface_allowed;
ALTER TABLE tideway_private.public_funnel_hourly ADD CONSTRAINT public_funnel_surface_allowed
  CHECK (surface IN ('','landing','for-landlords','for-cleaners','pricing','signup','app'));

CREATE OR REPLACE FUNCTION tideway_private.record_public_funnel_batch(payload jsonb) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE recorded integer;
BEGIN
  IF jsonb_typeof(payload) <> 'array' OR jsonb_array_length(payload) < 1 OR jsonb_array_length(payload) > 40 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-funnel-batch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload) entry
    WHERE jsonb_typeof(entry) <> 'object'
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(entry) key WHERE key NOT IN ('metric','dimensions','count'))
      OR jsonb_typeof(COALESCE(entry->'dimensions','{}'::jsonb)) <> 'object'
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(entry->'dimensions','{}'::jsonb)) key WHERE key NOT IN ('audience','surface'))
      OR COALESCE(entry->>'metric','') NOT IN (
        'funnel.landing.viewed','funnel.landing.cta',
        'funnel.signup.started','funnel.signup.completed',
        'funnel.property.added','funnel.scan.completed','funnel.price.shown',
        'funnel.slot.chosen','funnel.payment.authorised')
      OR COALESCE(entry->'dimensions'->>'audience','') NOT IN ('','customer','landlord','agent','cleaner','unknown')
      OR COALESCE(entry->'dimensions'->>'surface','') NOT IN ('','landing','for-landlords','for-cleaners','pricing','signup','app')
      OR COALESCE(entry->>'count','') !~ '^[1-9][0-9]{0,3}$'
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-funnel-event';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload) entry WHERE (entry->>'count')::numeric > 1000
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-funnel-count';
  END IF;

  WITH submitted AS (
    SELECT entry->>'metric' AS metric,
      COALESCE(entry->'dimensions'->>'audience','') AS audience,
      COALESCE(entry->'dimensions'->>'surface','') AS surface,
      (entry->>'count')::integer AS event_count
    FROM jsonb_array_elements(payload) entry
  ), folded AS (
    SELECT metric, audience, surface, sum(event_count)::bigint AS event_count
    FROM submitted GROUP BY metric, audience, surface
  ), stored AS (
    INSERT INTO tideway_private.public_funnel_hourly (observed_hour, metric, audience, surface, event_count)
    SELECT date_trunc('hour', now()), metric, audience, surface, event_count FROM folded
    ON CONFLICT (observed_hour, metric, audience, surface)
    DO UPDATE SET event_count = tideway_private.public_funnel_hourly.event_count + EXCLUDED.event_count, updated_at = now()
    RETURNING 1
  )
  SELECT COALESCE(sum(event_count), 0)::integer INTO recorded FROM folded;

  DELETE FROM tideway_private.public_funnel_hourly
  WHERE observed_hour < date_trunc('hour', now() - interval '90 days');
  RETURN recorded;
END $$;

COMMIT;
