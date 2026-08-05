BEGIN;

CREATE FUNCTION tideway_private.restore_my_property(target_property_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  property_record properties%ROWTYPE;
  restore_time timestamptz:=clock_timestamp();
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required';
  END IF;
  IF target_property_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-property-id';
  END IF;

  -- Restoration is deliberately owner-only and locks the archived row before
  -- changing it. The property becomes selectable for new requests only after
  -- this transaction commits; completed and cancelled history is untouched.
  SELECT * INTO property_record
  FROM properties property
  WHERE property.id=target_property_id
    AND property.landlord_user_id=actor_id
    AND property.archived_at IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='property-not-found';
  END IF;

  UPDATE properties
  SET archived_at=NULL,updated_at=restore_time
  WHERE id=property_record.id;

  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
  VALUES(
    actor_id,
    'property-restored',
    'property',
    property_record.id::text,
    jsonb_build_object('restoredAt',restore_time)
  );

  RETURN jsonb_build_object(
    'propertyId',property_record.id,
    'restoredAt',restore_time
  );
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.restore_my_property(uuid) FROM PUBLIC;

COMMIT;
