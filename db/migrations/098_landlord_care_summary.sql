-- The Landlord care record: the Home view's "Your care record" section.
--
-- Every figure is derived from records this schema already holds — completed
-- bookings, room-scan sessions and booking timestamps. Nothing here is
-- estimated, seeded or reset on a schedule: the reviewed retention concept is
-- explicit that a landlord's record is a business record, so when there is not
-- enough history for a figure the function returns NULL for it and the page
-- says so instead of inventing a label.
--
-- "Booking lag" is the hours between a booking being created and its scheduled
-- start — how quickly a clean is locked in once the landlord acts. The
-- anonymised benchmark compares per-landlord medians without exposing any
-- identity, address, postcode, room, media or monetary field of anyone else:
-- it returns only this landlord's standing (a percentage) and the cohort size.
BEGIN;

CREATE FUNCTION tideway_private.get_landlord_care_summary() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  result jsonb;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required';
  END IF;

  WITH own_bookings AS MATERIALIZED (
    SELECT
      booking.id,
      booking.created_at,
      booking.scheduled_start_at,
      booking.status,
      booking.customer_price_pence,
      EXTRACT(EPOCH FROM booking.scheduled_start_at-booking.created_at)/3600.0 AS lag_hours
    FROM bookings booking
    WHERE booking.landlord_user_id=actor_id
      AND booking.status<>'cancelled'
  ),
  own_totals AS (
    SELECT
      count(*) FILTER (WHERE status='completed')::integer AS completed_count,
      COALESCE(sum(customer_price_pence) FILTER (WHERE status='completed'),0)::bigint AS booked_value_pence,
      count(*)::integer AS booking_count
    FROM own_bookings
  ),
  own_rooms AS (
    SELECT count(scan.id)::integer AS rooms_scanned
    FROM room_scan_sessions scan_session
    JOIN room_scans scan ON scan.room_scan_session_id=scan_session.id
    WHERE scan_session.landlord_user_id=actor_id
  ),
  own_properties AS (
    SELECT count(*)::integer AS property_count
    FROM properties property
    WHERE property.landlord_user_id=actor_id AND property.archived_at IS NULL
  ),
  -- The median needs at least two real lags before it is a pattern rather
  -- than a single event; below that the page shows the record without a label.
  own_lag AS (
    SELECT
      CASE WHEN count(*)>=2
        THEN percentile_cont(0.5) WITHIN GROUP (ORDER BY lag_hours)
        ELSE NULL
      END AS median_lag_hours
    FROM own_bookings
    WHERE lag_hours IS NOT NULL AND lag_hours>=0
  ),
  -- The last eight turnaround events, oldest first. A "hit" is a clean whose
  -- start was locked in within 24 hours of the booking being created — the
  -- same boundary the Ready streak announces on the page. Freeze coverage is
  -- applied by the service, not here, so the data layer records only facts.
  streak_events AS (
    SELECT jsonb_agg(event.hit ORDER BY event.created_at ASC) AS events
    FROM (
      SELECT created_at,(lag_hours IS NOT NULL AND lag_hours>=0 AND lag_hours<=24) AS hit
      FROM own_bookings
      ORDER BY created_at DESC
      LIMIT 8
    ) event
  ),
  -- Anonymised cohort: every landlord with at least two non-cancelled
  -- bookings gets a median lag. Only the count of portfolios and where this
  -- landlord's median sits among them ever leave this query.
  cohort_lag AS MATERIALIZED (
    SELECT
      booking.landlord_user_id AS cohort_landlord,
      percentile_cont(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM booking.scheduled_start_at-booking.created_at)/3600.0
      ) AS median_lag_hours
    FROM bookings booking
    WHERE booking.status<>'cancelled'
      AND booking.scheduled_start_at>=booking.created_at
    GROUP BY booking.landlord_user_id
    HAVING count(*)>=2
  ),
  -- One row always, even with an empty cohort: the outer SELECT cross-joins
  -- these standings, so an empty CTE here would erase the whole record.
  lag_standing AS (
    SELECT
      count(cohort.cohort_landlord)::integer AS cohort_size,
      CASE WHEN own.median_lag_hours IS NULL OR count(cohort.cohort_landlord)=0 THEN NULL
        ELSE ceil(100.0*count(*) FILTER (
          WHERE cohort.median_lag_hours<=own.median_lag_hours
        )/count(cohort.cohort_landlord))::integer
      END AS top_percent
    FROM own_lag own
    LEFT JOIN cohort_lag cohort ON true
    GROUP BY own.median_lag_hours
  ),
  -- Scan coverage: per submitted request, the share of its checklist rooms
  -- that a structured scan actually walked. Averaged per landlord.
  request_coverage AS MATERIALIZED (
    SELECT
      request.landlord_user_id AS cohort_landlord,
      request.id AS request_id,
      request.submitted_at,
      LEAST(1.0,COALESCE(scanned.room_count,0)::numeric/GREATEST(planned.room_count,1)) AS share,
      COALESCE(scanned.room_count,0)::integer AS scanned_rooms,
      planned.room_count::integer AS planned_rooms
    FROM cleaning_requests request
    JOIN LATERAL (
      SELECT count(DISTINCT task.room_name)::integer AS room_count
      FROM cleaning_request_tasks task
      WHERE task.cleaning_request_id=request.id
    ) planned ON true
    LEFT JOIN LATERAL (
      SELECT count(scan.id)::integer AS room_count
      FROM room_scan_sessions scan_session
      JOIN room_scans scan ON scan.room_scan_session_id=scan_session.id
      WHERE scan_session.cleaning_request_id=request.id
    ) scanned ON true
    WHERE request.submitted_at IS NOT NULL
      AND planned.room_count>0
  ),
  cohort_coverage AS MATERIALIZED (
    SELECT cohort_landlord,avg(share) AS average_share
    FROM request_coverage
    GROUP BY cohort_landlord
  ),
  own_coverage AS (
    SELECT (
      SELECT average_share FROM cohort_coverage WHERE cohort_landlord=actor_id
    ) AS average_share
  ),
  own_latest_coverage AS (
    SELECT scanned_rooms,planned_rooms
    FROM request_coverage
    WHERE cohort_landlord=actor_id
    ORDER BY submitted_at DESC
    LIMIT 1
  ),
  coverage_standing AS (
    SELECT
      count(cohort.cohort_landlord)::integer AS cohort_size,
      CASE WHEN own.average_share IS NULL OR count(cohort.cohort_landlord)=0 THEN NULL
        ELSE ceil(100.0*count(*) FILTER (
          WHERE cohort.average_share>=own.average_share
        )/count(cohort.cohort_landlord))::integer
      END AS top_percent,
      percentile_cont(0.75) WITHIN GROUP (ORDER BY cohort.average_share) AS top_quarter_share
    FROM own_coverage own
    LEFT JOIN cohort_coverage cohort ON true
    GROUP BY own.average_share
  ),
  -- The latest structured scan, with an honest diff against the previous scan
  -- of the same property when one exists. When it finds nothing new, the page
  -- says nothing new — no find is ever manufactured.
  latest_scan AS (
    SELECT
      scan_session.id AS session_id,
      scan_session.captured_at,
      scan_session.created_at,
      request.id AS request_id,
      request.property_id,
      property.name AS property_name
    FROM room_scan_sessions scan_session
    JOIN cleaning_requests request ON request.id=scan_session.cleaning_request_id
    JOIN properties property ON property.id=request.property_id
    WHERE scan_session.landlord_user_id=actor_id
    ORDER BY COALESCE(scan_session.captured_at,scan_session.created_at) DESC
    LIMIT 1
  ),
  previous_scan AS (
    SELECT scan_session.id AS session_id,scan_session.captured_at,scan_session.created_at
    FROM room_scan_sessions scan_session
    JOIN cleaning_requests request ON request.id=scan_session.cleaning_request_id
    WHERE scan_session.landlord_user_id=actor_id
      AND request.property_id=(SELECT property_id FROM latest_scan)
      AND scan_session.id<>(SELECT session_id FROM latest_scan)
      AND COALESCE(scan_session.captured_at,scan_session.created_at)
        <=(SELECT COALESCE(captured_at,created_at) FROM latest_scan)
    ORDER BY COALESCE(scan_session.captured_at,scan_session.created_at) DESC
    LIMIT 1
  ),
  latest_scan_rooms AS (
    SELECT scan.id,scan.room_name
    FROM room_scans scan
    WHERE scan.room_scan_session_id=(SELECT session_id FROM latest_scan)
  ),
  latest_scan_detail AS (
    SELECT
      (SELECT count(*)::integer FROM latest_scan_rooms) AS room_count,
      (SELECT count(*)::integer FROM cleaning_request_tasks task
        WHERE task.cleaning_request_id=(SELECT request_id FROM latest_scan)) AS task_count,
      (SELECT COALESCE(jsonb_agg(named.room_name),'[]'::jsonb) FROM (
        SELECT task.room_name
        FROM cleaning_request_tasks task
        WHERE task.cleaning_request_id=(SELECT request_id FROM latest_scan)
        GROUP BY task.room_name
        ORDER BY min(task.sort_order),task.room_name
        LIMIT 2
      ) named) AS task_room_names,
      (SELECT count(*)::integer FROM latest_scan_rooms room
        WHERE NOT EXISTS (
          SELECT 1 FROM cleaning_request_tasks task
          WHERE task.cleaning_request_id=(SELECT request_id FROM latest_scan)
            AND lower(task.room_name)=lower(room.room_name)
        )) AS unchanged_room_count,
      (SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'label',new_object.label,
          'roomName',new_object.room_name,
          'evidence',new_object.evidence
        )),'[]'::jsonb) FROM (
        SELECT object.label,room.room_name,object.evidence
        FROM room_scan_objects object
        JOIN latest_scan_rooms room ON room.id=object.room_scan_id
        WHERE (SELECT session_id FROM previous_scan) IS NOT NULL
          AND object.condition IN ('medium','heavy')
          AND NOT EXISTS (
            SELECT 1 FROM room_scan_objects previous_object
            JOIN room_scans previous_room
              ON previous_room.id=previous_object.room_scan_id
            WHERE previous_room.room_scan_session_id=(SELECT session_id FROM previous_scan)
              AND previous_object.inventory_key=object.inventory_key
          )
        ORDER BY object.confidence_label DESC,object.label
        LIMIT 2
      ) new_object) AS new_objects
  )
  SELECT jsonb_build_object(
    'generatedAt',now(),
    'privacyScope','Own records plus anonymised cohort standing only. No other landlord''s identity, address, postcode, room, media or monetary data is included.',
    'totals',jsonb_build_object(
      'completedCleanCount',own_totals.completed_count,
      'bookedValuePence',own_totals.booked_value_pence,
      'roomsScannedCount',own_rooms.rooms_scanned,
      'propertyCount',own_properties.property_count,
      'bookingCount',own_totals.booking_count
    ),
    'medianLagHours',(SELECT median_lag_hours FROM own_lag),
    'streakEvents',COALESCE((SELECT events FROM streak_events),'[]'::jsonb),
    'benchmark',CASE
      WHEN lag_standing.cohort_size>=3 THEN jsonb_build_object(
        'cohortSize',lag_standing.cohort_size,
        'lagTopPercent',lag_standing.top_percent,
        'coverageCohortSize',coverage_standing.cohort_size,
        'coverageTopPercent',coverage_standing.top_percent,
        'coverageShare',(SELECT round(average_share*100)::integer FROM own_coverage),
        'latestScannedRooms',(SELECT scanned_rooms FROM own_latest_coverage),
        'latestPlannedRooms',(SELECT planned_rooms FROM own_latest_coverage),
        'closingGapReachesTopQuarter',(
          SELECT count(*)>0 FROM own_latest_coverage latest
          WHERE latest.planned_rooms>latest.scanned_rooms
            AND coverage_standing.top_quarter_share IS NOT NULL
            AND (SELECT average_share FROM own_coverage)
              +((latest.planned_rooms-latest.scanned_rooms)::numeric/latest.planned_rooms)
                /GREATEST((SELECT count(*) FROM request_coverage WHERE cohort_landlord=actor_id),1)
              >=coverage_standing.top_quarter_share
        )
      )
      ELSE NULL
    END,
    'lastScan',CASE
      WHEN (SELECT session_id FROM latest_scan) IS NOT NULL THEN jsonb_build_object(
        'propertyName',(SELECT property_name FROM latest_scan),
        'capturedAt',(SELECT COALESCE(captured_at,created_at) FROM latest_scan),
        'roomCount',(SELECT room_count FROM latest_scan_detail),
        'taskCount',(SELECT task_count FROM latest_scan_detail),
        'taskRoomNames',(SELECT task_room_names FROM latest_scan_detail),
        'unchangedRoomCount',(SELECT unchanged_room_count FROM latest_scan_detail),
        'newObjects',(SELECT new_objects FROM latest_scan_detail),
        'previousCapturedAt',(SELECT COALESCE(captured_at,created_at) FROM previous_scan)
      )
      ELSE NULL
    END
  ) INTO result
  FROM own_totals,own_rooms,own_properties,lag_standing,coverage_standing;

  RETURN result;
END;
$$;

COMMIT;
