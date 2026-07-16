BEGIN;

ALTER FUNCTION tideway_private.invite_cleaner(uuid,uuid,uuid,timestamptz,integer,integer,integer,integer,integer,integer,integer,integer)
  RENAME TO invite_cleaner_before_eligibility_hardening;

CREATE FUNCTION tideway_private.invite_cleaner(
  proposed_booking_id uuid,
  target_request_id uuid,
  target_cleaner_id uuid,
  response_deadline timestamptz,
  proposed_customer_price_pence integer,
  proposed_cleaner_pay_pence integer,
  proposed_labour_on_cost_pence integer,
  proposed_payment_fee_pence integer,
  proposed_travel_cost_pence integer,
  proposed_supplies_cost_pence integer,
  proposed_other_cost_pence integer,
  proposed_target_margin_basis_points integer
) RETURNS bookings
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  request_record cleaning_requests%ROWTYPE;
  property_record properties%ROWTYPE;
  profile_record cleaner_profiles%ROWTYPE;
  outward_postcode text;
  duration_minutes integer;
  priced_service_count integer;
  expected_cleaner_pay bigint;
BEGIN
  IF actor_id IS NULL OR NOT (tideway_private.has_role('landlord') OR tideway_private.has_role('administrator')) THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required';
  END IF;
  IF target_cleaner_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='cleaner-not-eligible'; END IF;

  SELECT * INTO request_record FROM cleaning_requests request
    WHERE request.id=target_request_id
      AND (request.landlord_user_id=actor_id OR tideway_private.has_role('administrator'))
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-not-found'; END IF;
  IF request_record.status<>'searching-for-cleaner' OR request_record.submitted_at IS NULL OR request_record.requested_start_at<=now() THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='request-not-matchable';
  END IF;

  -- Serialize every pending/accept operation for this Cleaner before checking schedule holds.
  PERFORM pg_advisory_xact_lock(hashtextextended(target_cleaner_id::text,0));

  SELECT * INTO property_record FROM properties property
    WHERE property.id=request_record.property_id AND property.archived_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='property-not-found'; END IF;

  SELECT profile.* INTO profile_record FROM cleaner_profiles profile
    JOIN users account ON account.id=profile.user_id AND account.account_status='active'
    WHERE profile.user_id=target_cleaner_id
      AND profile.is_public AND profile.profile_completion_percent=100
      AND profile.current_availability_status<>'unavailable'
    FOR SHARE OF profile;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='cleaner-account-inactive'; END IF;

  IF (property_record.property_type IN ('house','flat','studio') AND NOT profile_record.residential_preference)
    OR (property_record.property_type IN ('office','retail','clinic','communal') AND NOT profile_record.commercial_preference)
    OR (property_record.property_type='other' AND NOT (profile_record.residential_preference OR profile_record.commercial_preference))
    OR property_record.property_type NOT IN ('house','flat','studio','office','retail','clinic','communal','other') THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='cleaner-property-mismatch';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cleaner_availability availability
    WHERE availability.cleaner_user_id=target_cleaner_id AND availability.status='available'
      AND availability.starts_at<=request_record.requested_start_at
      AND availability.ends_at>=request_record.requested_end_at
  ) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='cleaner-unavailable'; END IF;

  duration_minutes:=ceil(extract(epoch FROM (request_record.requested_end_at-request_record.requested_start_at))/60)::integer;
  SELECT count(*)::integer,
         COALESCE(sum(CASE service.pricing_model
           WHEN 'hourly' THEN ceil(service.price_pence::numeric*duration_minutes/60)::bigint
           WHEN 'fixed' THEN service.price_pence::bigint
           ELSE NULL END),0)
    INTO priced_service_count,expected_cleaner_pay
  FROM unnest(request_record.required_services) required(service_code)
  JOIN cleaner_services service ON service.cleaner_user_id=target_cleaner_id
    AND service.service_code=required.service_code AND service.is_active
    AND service.pricing_model IN ('hourly','fixed') AND service.price_pence IS NOT NULL;
  IF priced_service_count<>cardinality(request_record.required_services) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='cleaner-services-mismatch';
  END IF;
  IF expected_cleaner_pay<>proposed_cleaner_pay_pence THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='cleaner-price-changed';
  END IF;

  outward_postcode:=substring(upper(replace(property_record.postcode,' ','')) FROM '^([A-Z]{1,2}[0-9][A-Z0-9]?)');
  IF NOT EXISTS (
    SELECT 1 FROM cleaner_service_areas area
    WHERE area.cleaner_user_id=target_cleaner_id AND area.outward_postcode=outward_postcode
  ) AND NOT EXISTS (
    SELECT 1 FROM cleaner_service_areas area
    WHERE area.cleaner_user_id=target_cleaner_id
      AND property_record.latitude IS NOT NULL AND property_record.longitude IS NOT NULL
      AND area.latitude IS NOT NULL AND area.longitude IS NOT NULL
      AND profile_record.travel_radius_km IS NOT NULL
      AND 6371*acos(LEAST(1,GREATEST(-1,
        sin(radians(property_record.latitude::double precision))*sin(radians(area.latitude::double precision))+
        cos(radians(property_record.latitude::double precision))*cos(radians(area.latitude::double precision))*
        cos(radians(area.longitude::double precision-property_record.longitude::double precision))
      )))<=profile_record.travel_radius_km
  ) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='cleaner-outside-service-area'; END IF;

  IF EXISTS (
    SELECT 1 FROM bookings occupied
    WHERE occupied.cleaner_user_id=target_cleaner_id
      AND occupied.status IN ('pending-cleaner-acceptance','confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review')
      AND tstzrange(occupied.scheduled_start_at,occupied.scheduled_end_at,'[)') &&
          tstzrange(request_record.requested_start_at,request_record.requested_end_at,'[)')
  ) THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='cleaner-has-overlapping-invitation'; END IF;

  RETURN tideway_private.invite_cleaner_before_eligibility_hardening(
    proposed_booking_id,target_request_id,target_cleaner_id,response_deadline,
    proposed_customer_price_pence,proposed_cleaner_pay_pence,proposed_labour_on_cost_pence,
    proposed_payment_fee_pence,proposed_travel_cost_pence,proposed_supplies_cost_pence,
    proposed_other_cost_pence,proposed_target_margin_basis_points
  );
END;
$$;

ALTER FUNCTION tideway_private.respond_to_cleaner_invitation(uuid,text,text)
  RENAME TO respond_to_cleaner_invitation_before_eligibility_hardening;

CREATE FUNCTION tideway_private.respond_to_cleaner_invitation(target_booking_id uuid,decision text,supplied_reason text DEFAULT NULL)
RETURNS bookings
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); target_cleaner_id uuid;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='cleaner-required';
  END IF;
  SELECT booking.cleaner_user_id INTO target_cleaner_id FROM bookings booking
    WHERE booking.id=target_booking_id AND booking.cleaner_user_id=actor_id;
  IF target_cleaner_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(target_cleaner_id::text,0));
  END IF;
  RETURN tideway_private.respond_to_cleaner_invitation_before_eligibility_hardening(target_booking_id,decision,supplied_reason);
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.invite_cleaner_before_eligibility_hardening(uuid,uuid,uuid,timestamptz,integer,integer,integer,integer,integer,integer,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.invite_cleaner(uuid,uuid,uuid,timestamptz,integer,integer,integer,integer,integer,integer,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.respond_to_cleaner_invitation_before_eligibility_hardening(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.respond_to_cleaner_invitation(uuid,text,text) FROM PUBLIC;

COMMIT;
