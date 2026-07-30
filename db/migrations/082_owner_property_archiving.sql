BEGIN;

CREATE FUNCTION tideway_private.archive_my_property(target_property_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  property_record properties%ROWTYPE;
  archive_time timestamptz:=clock_timestamp();
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required';
  END IF;
  IF target_property_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-property-id';
  END IF;

  -- The row lock serializes this decision with request creation, which takes a
  -- share lock on the same active property. A request either wins and blocks
  -- this archive, or the archive wins and the request can no longer select it.
  SELECT * INTO property_record
  FROM properties property
  WHERE property.id=target_property_id
    AND property.landlord_user_id=actor_id
    AND property.archived_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='property-not-found';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM cleaning_requests request
    WHERE request.property_id=property_record.id
      AND (
        request.status IN ('draft','searching-for-cleaner','cleaner-invited','pending-cleaner-acceptance')
        OR (
          request.status='matched'
          AND NOT EXISTS (
            SELECT 1
            FROM bookings finished_booking
            WHERE finished_booking.cleaning_request_id=request.id
              AND finished_booking.status IN ('completed','cancelled')
          )
        )
      )
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='property-has-active-request';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM bookings booking
    WHERE booking.property_id=property_record.id
      AND booking.status NOT IN ('completed','cancelled')
  ) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='property-has-active-booking';
  END IF;

  UPDATE properties
  SET archived_at=archive_time,updated_at=archive_time
  WHERE id=property_record.id;

  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  VALUES(
    actor_id,
    'property-archived',
    'property',
    property_record.id::text,
    jsonb_build_object('archivedAt',archive_time)
  );

  RETURN jsonb_build_object(
    'propertyId',property_record.id,
    'archivedAt',archive_time
  );
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.archive_my_property(uuid) FROM PUBLIC;

COMMIT;
