-- Privacy-minimal marketplace funnel reporting for Homle Administrators.
--
-- The report derives aggregate counts from the authoritative account, property,
-- request, scan, booking, payment and review tables. It creates no browser
-- tracking identifiers and returns no identity, address, postcode, room, media,
-- provider or monetary fields.
--
-- Each lane is a separate cohort. A 24-hour maturity delay prevents an account
-- or request that is still being completed from being labelled as abandonment.
BEGIN;

CREATE FUNCTION tideway_private.get_administrator_funnel_report(
  window_days integer DEFAULT 30
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  cohort_end timestamptz:=now()-interval '24 hours';
  cohort_start timestamptz;
  result jsonb;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='administrator-required';
  END IF;
  IF window_days IS NULL OR window_days NOT IN (7,30,90) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-funnel-window';
  END IF;

  cohort_start:=now()-make_interval(days=>window_days);

  WITH landlord_accounts AS MATERIALIZED (
    SELECT DISTINCT role.user_id
    FROM user_roles role
    JOIN users account ON account.id=role.user_id
    WHERE role.role='landlord'
      AND role.granted_at>=cohort_start
      AND role.granted_at<cohort_end
      AND account.account_status='active'
      AND account.email_verified_at IS NOT NULL
  ),
  account_lane AS (
    SELECT
      count(*)::integer AS account_count,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM landlord_profiles profile WHERE profile.user_id=account.user_id
      ))::integer AS profile_count,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM properties property
        WHERE property.landlord_user_id=account.user_id AND property.archived_at IS NULL
      ))::integer AS property_count
    FROM landlord_accounts account
  ),
  request_cohort AS MATERIALIZED (
    SELECT request.id
    FROM cleaning_requests request
    WHERE request.created_at>=cohort_start
      AND request.created_at<cohort_end
      AND request.status<>'cancelled'
  ),
  request_lane AS (
    SELECT
      count(*)::integer AS request_count,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM room_scan_sessions scan WHERE scan.cleaning_request_id=request.id
      ))::integer AS scan_count,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM room_scan_sessions scan WHERE scan.cleaning_request_id=request.id
      ) AND EXISTS (
        SELECT 1 FROM cleaning_requests current_request
        WHERE current_request.id=request.id AND current_request.submitted_at IS NOT NULL
      ))::integer AS submitted_count,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM room_scan_sessions scan WHERE scan.cleaning_request_id=request.id
      ) AND EXISTS (
        SELECT 1 FROM cleaning_requests current_request
        WHERE current_request.id=request.id AND current_request.submitted_at IS NOT NULL
      ) AND EXISTS (
        SELECT 1 FROM bookings booking WHERE booking.cleaning_request_id=request.id
      ))::integer AS booking_count,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM room_scan_sessions scan WHERE scan.cleaning_request_id=request.id
      ) AND EXISTS (
        SELECT 1 FROM cleaning_requests current_request
        WHERE current_request.id=request.id AND current_request.submitted_at IS NOT NULL
      ) AND EXISTS (
        SELECT 1 FROM bookings booking
        WHERE booking.cleaning_request_id=request.id
          AND booking.status='completed' AND booking.completed_at IS NOT NULL
      ))::integer AS completed_count,
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM room_scan_sessions scan WHERE scan.cleaning_request_id=request.id
      ) AND EXISTS (
        SELECT 1 FROM cleaning_requests current_request
        WHERE current_request.id=request.id AND current_request.submitted_at IS NOT NULL
      ) AND EXISTS (
        SELECT 1 FROM bookings booking
        JOIN reviews review ON review.booking_id=booking.id
        WHERE booking.cleaning_request_id=request.id
          AND booking.status='completed' AND booking.completed_at IS NOT NULL
      ))::integer AS review_count
    FROM request_cohort request
  ),
  booking_cohort AS MATERIALIZED (
    SELECT booking.id
    FROM bookings booking
    WHERE booking.created_at>=cohort_start
      AND booking.created_at<cohort_end
      AND booking.status<>'cancelled'
  ),
  payment_lane AS (
    SELECT
      count(*)::integer AS booking_count,
      count(*) FILTER (WHERE payment.id IS NOT NULL)::integer AS payment_record_count,
      count(*) FILTER (WHERE payment.status IN (
        'authorized','captured','partially-refunded','refunded','disputed'
      ))::integer AS authorized_count,
      count(*) FILTER (WHERE payment.status IN (
        'captured','partially-refunded','refunded','disputed'
      ))::integer AS captured_count,
      count(*) FILTER (WHERE payment.status IN (
        'partially-refunded','refunded'
      ))::integer AS refunded_count
    FROM booking_cohort booking
    LEFT JOIN booking_payments payment ON payment.booking_id=booking.id
  )
  SELECT jsonb_build_object(
    'windowDays',window_days,
    'generatedAt',now(),
    'cohortStartAt',cohort_start,
    'cohortEndAt',cohort_end,
    'maturityHours',24,
    'privacyScope','Aggregate stage counts only. No identity, address, postcode, room, media, provider or monetary data is included.',
    'cohortPolicy','Each lane is an independent cohort and excludes records created in the last 24 hours.',
    'onboarding',jsonb_build_object(
      'accountCount',account_lane.account_count,
      'profileCount',account_lane.profile_count,
      'propertyCount',account_lane.property_count
    ),
    'requestJourney',jsonb_build_object(
      'requestCount',request_lane.request_count,
      'scanCount',request_lane.scan_count,
      'submittedCount',request_lane.submitted_count,
      'bookingCount',request_lane.booking_count,
      'completedCount',request_lane.completed_count,
      'reviewCount',request_lane.review_count
    ),
    'payments',jsonb_build_object(
      'bookingCount',payment_lane.booking_count,
      'paymentRecordCount',payment_lane.payment_record_count,
      'authorizedCount',payment_lane.authorized_count,
      'capturedCount',payment_lane.captured_count,
      'refundedCount',payment_lane.refunded_count
    )
  ) INTO result
  FROM account_lane CROSS JOIN request_lane CROSS JOIN payment_lane;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.get_administrator_funnel_report(integer) FROM PUBLIC;

COMMIT;
