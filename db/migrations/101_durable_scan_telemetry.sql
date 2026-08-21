-- Durable, privacy-minimal scanner operations telemetry.
--
-- This table cannot describe a home or a person. Its complete vocabulary is
-- fixed below: one metric, three bounded dimensions, one coarse timing bucket
-- and a count. There is deliberately no account, session, request, property,
-- room, object, note, transcript, media key or timestamp more precise than an
-- hour. Rows older than 90 days are deleted on every write.
BEGIN;

CREATE TABLE tideway_private.scan_telemetry_hourly (
  observed_hour timestamptz NOT NULL,
  metric text NOT NULL,
  device_class text NOT NULL DEFAULT '',
  outcome text NOT NULL DEFAULT '',
  level text NOT NULL DEFAULT '',
  duration_bucket text NOT NULL DEFAULT '',
  event_count bigint NOT NULL CHECK (event_count > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (observed_hour,metric,device_class,outcome,level,duration_bucket),
  CONSTRAINT scan_telemetry_metric_allowed CHECK (metric IN (
    'scan.session.started','scan.session.completed','scan.session.abandoned','scan.room.completed',
    'scan.reading.succeeded','scan.reading.failed','scan.reading.unavailable',
    'scan.object.corrected','scan.object.removed','scan.condition.unresolved',
    'scan.redaction.applied','scan.redaction.frame_rejected','scan.camera.denied',
    'scan.camera.unavailable','scan.assist.torch','scan.assist.zoom',
    'scan.detector.unavailable','scan.upload.failed','scan.crash',
    'scan.estimate.produced','scan.estimate.refused','scan.room.duration_ms',
    'scan.reading.latency_ms','scan.session.duration_ms'
  )),
  CONSTRAINT scan_telemetry_device_allowed CHECK (device_class IN ('','guided-web','camera-fallback','unknown')),
  CONSTRAINT scan_telemetry_outcome_allowed CHECK (outcome IN ('','ok','timeout','provider-error','offline','declined')),
  CONSTRAINT scan_telemetry_level_allowed CHECK (level IN ('','0','1','2','3','4','5')),
  CONSTRAINT scan_telemetry_bucket_allowed CHECK (duration_bucket IN (
    '','0-250ms','250-500ms','500-1000ms','1000-2000ms','2000-4000ms',
    '4000-8000ms','8000-15000ms','15000-30000ms','30000-60000ms',
    '60000-120000ms','120000-300000ms','300000ms+'
  ))
);

ALTER TABLE tideway_private.scan_telemetry_hourly ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION tideway_private.record_scan_telemetry_batch(payload jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE recorded integer;
BEGIN
  IF jsonb_typeof(payload)<>'array' OR jsonb_array_length(payload)<1 OR jsonb_array_length(payload)>500 THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-scan-telemetry-batch';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload) entry
    WHERE jsonb_typeof(entry)<>'object'
      OR EXISTS (SELECT 1 FROM jsonb_object_keys(entry) key WHERE key NOT IN ('metric','dimensions','bucket','count'))
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
  -- Keep the numeric cast in its own statement. The shape check above must
  -- finish first so PostgreSQL can never evaluate a cast on attacker-supplied
  -- non-numeric JSON while reordering boolean predicates.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(payload) entry
    WHERE (entry->>'count')::numeric>10000
  ) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-scan-telemetry-count';
  END IF;

  INSERT INTO tideway_private.scan_telemetry_hourly (
    observed_hour,metric,device_class,outcome,level,duration_bucket,event_count
  )
  SELECT date_trunc('hour',now()),entry->>'metric',
    COALESCE(entry->'dimensions'->>'deviceClass',''),COALESCE(entry->'dimensions'->>'outcome',''),
    COALESCE(entry->'dimensions'->>'level',''),COALESCE(entry->>'bucket',''),(entry->>'count')::integer
  FROM jsonb_array_elements(payload) entry
  ON CONFLICT (observed_hour,metric,device_class,outcome,level,duration_bucket)
  DO UPDATE SET event_count=tideway_private.scan_telemetry_hourly.event_count+EXCLUDED.event_count,updated_at=now();
  GET DIAGNOSTICS recorded=ROW_COUNT;

  DELETE FROM tideway_private.scan_telemetry_hourly
  WHERE observed_hour<date_trunc('hour',now()-interval '90 days');
  RETURN recorded;
END $$;

CREATE FUNCTION tideway_private.get_administrator_scan_telemetry(window_days integer DEFAULT 30) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='administrator-required';
  END IF;
  IF window_days NOT IN (7,30,90) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-scan-telemetry-window';
  END IF;

  WITH aggregate AS (
    SELECT metric,device_class,outcome,level,duration_bucket,sum(event_count)::bigint AS total
    FROM tideway_private.scan_telemetry_hourly
    WHERE observed_hour>=date_trunc('hour',now()-make_interval(days=>window_days))
    GROUP BY metric,device_class,outcome,level,duration_bucket
  ), series AS (
    SELECT metric
      || CASE WHEN device_class<>'' OR level<>'' OR outcome<>'' THEN '|'
        || concat_ws(',',NULLIF('deviceClass='||device_class,'deviceClass='),NULLIF('level='||level,'level='),NULLIF('outcome='||outcome,'outcome=')) ELSE '' END
      || CASE WHEN duration_bucket<>'' THEN '|'||duration_bucket ELSE '' END AS series_key,
      total,duration_bucket
    FROM aggregate
  )
  SELECT jsonb_build_object(
    'counters',COALESCE(jsonb_object_agg(series_key,total) FILTER (WHERE duration_bucket=''),'{}'::jsonb),
    'timings',COALESCE(jsonb_object_agg(series_key,total) FILTER (WHERE duration_bucket<>''),'{}'::jsonb)
  ) INTO result FROM series;
  RETURN COALESCE(result,jsonb_build_object('counters','{}'::jsonb,'timings','{}'::jsonb));
END $$;

REVOKE ALL ON TABLE tideway_private.scan_telemetry_hourly FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.record_scan_telemetry_batch(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_administrator_scan_telemetry(integer) FROM PUBLIC;

COMMIT;
