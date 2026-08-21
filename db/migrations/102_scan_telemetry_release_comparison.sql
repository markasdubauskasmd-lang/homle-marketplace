-- Attribute anonymous scanner aggregates to the immutable packaged release.
--
-- The release is server-owned and bounded to eight hexadecimal characters.
-- It is not an account, request, property, scan or session identifier. Existing
-- rows are retained as "unknown" so this migration never invents provenance.
BEGIN;

ALTER TABLE tideway_private.scan_telemetry_hourly
  ADD COLUMN release_commit text NOT NULL DEFAULT 'unknown';
ALTER TABLE tideway_private.scan_telemetry_hourly
  ADD CONSTRAINT scan_telemetry_release_allowed
  CHECK (release_commit='unknown' OR release_commit ~ '^[0-9a-f]{8}$');
ALTER TABLE tideway_private.scan_telemetry_hourly
  DROP CONSTRAINT scan_telemetry_hourly_pkey;
ALTER TABLE tideway_private.scan_telemetry_hourly
  ADD PRIMARY KEY (observed_hour,release_commit,metric,device_class,outcome,level,duration_bucket);

CREATE OR REPLACE FUNCTION tideway_private.record_scan_telemetry_batch(payload jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE recorded integer;
BEGIN
  IF jsonb_typeof(payload)<>'array' OR jsonb_array_length(payload)<1 OR jsonb_array_length(payload)>500 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-scan-telemetry-batch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload) entry
    WHERE jsonb_typeof(entry)<>'object'
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(entry) key WHERE key NOT IN ('metric','dimensions','bucket','count','releaseCommit'))
      OR COALESCE(entry->>'releaseCommit','') !~ '^[0-9a-f]{8}$'
      OR jsonb_typeof(COALESCE(entry->'dimensions','{}'::jsonb))<>'object'
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(COALESCE(entry->'dimensions','{}'::jsonb)) key WHERE key NOT IN ('deviceClass','outcome','level'))
      OR COALESCE(entry->'dimensions'->>'deviceClass','') NOT IN ('','guided-web','camera-fallback','unknown')
      OR COALESCE(entry->'dimensions'->>'outcome','') NOT IN ('','ok','timeout','provider-error','offline','declined')
      OR COALESCE(entry->'dimensions'->>'level','') NOT IN ('','0','1','2','3','4','5')
      OR COALESCE(entry->>'count','') !~ '^[1-9][0-9]{0,4}$'
      OR (
        entry->>'metric' IN ('scan.room.duration_ms','scan.reading.latency_ms','scan.session.duration_ms')
        AND COALESCE(entry->>'bucket','') NOT IN ('0-250ms','250-500ms','500-1000ms','1000-2000ms','2000-4000ms','4000-8000ms','8000-15000ms','15000-30000ms','30000-60000ms','60000-120000ms','120000-300000ms','300000ms+')
      )
      OR (
        entry->>'metric' NOT IN ('scan.room.duration_ms','scan.reading.latency_ms','scan.session.duration_ms')
        AND COALESCE(entry->>'bucket','')<>''
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-scan-telemetry-event';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload) entry
    WHERE (entry->>'count')::numeric>10000
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-scan-telemetry-count';
  END IF;

  INSERT INTO tideway_private.scan_telemetry_hourly (
    observed_hour,release_commit,metric,device_class,outcome,level,duration_bucket,event_count
  )
  SELECT date_trunc('hour',now()),entry->>'releaseCommit',entry->>'metric',
    COALESCE(entry->'dimensions'->>'deviceClass',''),COALESCE(entry->'dimensions'->>'outcome',''),
    COALESCE(entry->'dimensions'->>'level',''),COALESCE(entry->>'bucket',''),(entry->>'count')::integer
  FROM jsonb_array_elements(payload) entry
  ON CONFLICT (observed_hour,release_commit,metric,device_class,outcome,level,duration_bucket)
  DO UPDATE SET event_count=tideway_private.scan_telemetry_hourly.event_count+EXCLUDED.event_count,updated_at=now();
  GET DIAGNOSTICS recorded=ROW_COUNT;

  DELETE FROM tideway_private.scan_telemetry_hourly
  WHERE observed_hour<date_trunc('hour',now()-interval '90 days');
  RETURN recorded;
END $$;

CREATE OR REPLACE FUNCTION tideway_private.get_administrator_scan_telemetry(window_days integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='administrator-required';
  END IF;
  IF window_days NOT IN (7,30,90) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-scan-telemetry-window';
  END IF;

  WITH source AS (
    SELECT observed_hour,release_commit,metric,device_class,outcome,level,duration_bucket,event_count
    FROM tideway_private.scan_telemetry_hourly
    WHERE observed_hour>=date_trunc('hour',now()-make_interval(days=>window_days))
  ), aggregate AS (
    SELECT metric,device_class,outcome,level,duration_bucket,sum(event_count)::bigint AS total
    FROM source GROUP BY metric,device_class,outcome,level,duration_bucket
  ), series AS (
    SELECT metric
      || CASE WHEN device_class<>'' OR level<>'' OR outcome<>'' THEN '|'
        || concat_ws(',',NULLIF('deviceClass='||device_class,'deviceClass='),NULLIF('level='||level,'level='),NULLIF('outcome='||outcome,'outcome=')) ELSE '' END
      || CASE WHEN duration_bucket<>'' THEN '|'||duration_bucket ELSE '' END AS series_key,
      total,duration_bucket
    FROM aggregate
  ), release_aggregate AS (
    SELECT release_commit,metric,device_class,outcome,level,duration_bucket,
      sum(event_count)::bigint AS total,min(observed_hour) AS first_observed_hour,max(observed_hour) AS last_observed_hour
    FROM source GROUP BY release_commit,metric,device_class,outcome,level,duration_bucket
  ), release_series AS (
    SELECT release_commit,metric
      || CASE WHEN device_class<>'' OR level<>'' OR outcome<>'' THEN '|'
        || concat_ws(',',NULLIF('deviceClass='||device_class,'deviceClass='),NULLIF('level='||level,'level='),NULLIF('outcome='||outcome,'outcome=')) ELSE '' END
      || CASE WHEN duration_bucket<>'' THEN '|'||duration_bucket ELSE '' END AS series_key,
      total,duration_bucket,first_observed_hour,last_observed_hour
    FROM release_aggregate
  ), release_snapshots AS (
    SELECT release_commit,min(first_observed_hour) AS first_observed_hour,max(last_observed_hour) AS last_observed_hour,
      COALESCE(jsonb_object_agg(series_key,total) FILTER (WHERE duration_bucket=''),'{}'::jsonb) AS counters,
      COALESCE(jsonb_object_agg(series_key,total) FILTER (WHERE duration_bucket<>''),'{}'::jsonb) AS timings
    FROM release_series GROUP BY release_commit
  ), recent_releases AS (
    SELECT * FROM release_snapshots ORDER BY last_observed_hour DESC,release_commit DESC LIMIT 8
  )
  SELECT jsonb_build_object(
    'counters',COALESCE((SELECT jsonb_object_agg(series_key,total) FROM series WHERE duration_bucket=''),'{}'::jsonb),
    'timings',COALESCE((SELECT jsonb_object_agg(series_key,total) FROM series WHERE duration_bucket<>''),'{}'::jsonb),
    'releases',COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'releaseCommit',release_commit,'firstObservedHour',first_observed_hour,'lastObservedHour',last_observed_hour,
      'counters',counters,'timings',timings
    ) ORDER BY last_observed_hour DESC,release_commit DESC) FROM recent_releases),'[]'::jsonb)
  ) INTO result;
  RETURN COALESCE(result,jsonb_build_object('counters','{}'::jsonb,'timings','{}'::jsonb,'releases','[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION tideway_private.record_scan_telemetry_batch(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_administrator_scan_telemetry(integer) FROM PUBLIC;

COMMIT;
