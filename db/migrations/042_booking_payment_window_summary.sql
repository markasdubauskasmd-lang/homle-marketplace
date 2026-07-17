BEGIN;

CREATE OR REPLACE FUNCTION tideway_private.list_my_booking_summaries(maximum_results integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  summaries jsonb;
BEGIN
  IF actor_id IS NULL OR NOT (tideway_private.has_role('cleaner') OR tideway_private.has_role('landlord')) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'booking-participant-required';
  END IF;
  IF maximum_results IS NULL OR maximum_results < 1 OR maximum_results > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid-booking-summary-limit';
  END IF;

  SELECT COALESCE(jsonb_agg(item.summary ORDER BY item.sort_rank, item.future_start ASC NULLS LAST, item.past_start DESC NULLS LAST, item.booking_id), '[]'::jsonb)
  INTO summaries
  FROM (
    SELECT booking.id AS booking_id,
      CASE
        WHEN booking.cleaner_user_id = actor_id AND booking.status = 'pending-cleaner-acceptance' THEN 0
        WHEN booking.status IN ('cleaner-en-route','cleaner-arrived','cleaning-in-progress') THEN 1
        WHEN booking.status IN ('confirmed','awaiting-review','disputed') THEN 2
        ELSE 3
      END AS sort_rank,
      CASE WHEN booking.scheduled_start_at >= now() THEN booking.scheduled_start_at END AS future_start,
      CASE WHEN booking.scheduled_start_at < now() THEN booking.scheduled_start_at END AS past_start,
      jsonb_build_object(
        'bookingId', booking.id,
        'participantRole', CASE WHEN booking.landlord_user_id = actor_id THEN 'landlord' ELSE 'cleaner' END,
        'status', booking.status,
        'scheduledStartAt', booking.scheduled_start_at,
        'scheduledEndAt', booking.scheduled_end_at,
        'responseDeadline', CASE WHEN booking.cleaner_user_id = actor_id AND booking.status = 'pending-cleaner-acceptance' THEN booking.cleaner_response_deadline END,
        'pricePence', CASE WHEN booking.landlord_user_id = actor_id THEN booking.customer_price_pence ELSE booking.cleaner_pay_pence END,
        'pricePerspective', CASE WHEN booking.landlord_user_id = actor_id THEN 'customer-total' ELSE 'cleaner-pay' END,
        'propertyName', CASE
          WHEN booking.landlord_user_id = actor_id OR booking.status IN ('confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review') THEN property.name
          ELSE 'Cleaning property'
        END,
        'propertyArea', substring(upper(regexp_replace(property.postcode, '\s', '', 'g')) FROM '^([A-Z]{1,2}[0-9][A-Z0-9]?)'),
        'cleaningType', COALESCE(booking.scope_snapshot->>'cleaningType', 'Cleaning'),
        'taskCount', (SELECT count(*) FROM cleaning_tasks task WHERE task.booking_id = booking.id),
        'counterpartyName', CASE
          WHEN booking.landlord_user_id = actor_id THEN cleaner_user.display_name
          WHEN booking.status IN ('confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review') THEN COALESCE(landlord_profile.organisation_name, 'Landlord')
          ELSE 'Landlord'
        END,
        'canRespond', booking.cleaner_user_id = actor_id AND booking.status = 'pending-cleaner-acceptance' AND booking.cleaner_response_deadline > now(),
        'activeJobAvailable', booking.status IN ('confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review','completed','disputed'),
        'respondedAt', booking.responded_at,
        'confirmedAt', booking.confirmed_at
      ) || CASE WHEN booking.landlord_user_id=actor_id THEN jsonb_build_object(
        'paymentAuthorizationReady', booking.status = 'confirmed' AND COALESCE(payment_state.authorization_ready,false),
        'paymentStepAvailable', booking.status = 'confirmed'
          AND booking.scheduled_start_at > now() AND booking.scheduled_start_at <= now()+interval '5 days'
          AND NOT COALESCE(payment_state.authorization_ready,false),
        'paymentStepOpensAt', CASE
          WHEN booking.status = 'confirmed' AND booking.scheduled_start_at > now()+interval '5 days'
          THEN booking.scheduled_start_at-interval '5 days'
        END
      ) ELSE '{}'::jsonb END AS summary
    FROM bookings booking
    JOIN properties property ON property.id = booking.property_id
    JOIN users cleaner_user ON cleaner_user.id = booking.cleaner_user_id
    LEFT JOIN landlord_profiles landlord_profile ON landlord_profile.user_id = booking.landlord_user_id
    LEFT JOIN LATERAL (
      SELECT true AS authorization_ready
      FROM booking_payments payment
      WHERE payment.booking_id=booking.id
        AND payment.landlord_user_id=booking.landlord_user_id
        AND payment.cleaner_user_id=booking.cleaner_user_id
        AND payment.provider='stripe'
        AND payment.provider_payment_id IS NOT NULL
        AND payment.status='authorized'
        AND payment.currency='gbp'
        AND payment.amount_pence=booking.customer_price_pence
        AND payment.terms_fingerprint=booking.terms_fingerprint
        AND payment.authorized_at BETWEEN booking.scheduled_start_at-interval '5 days' AND now()+interval '5 minutes'
      LIMIT 1
    ) payment_state ON booking.landlord_user_id=actor_id AND booking.status='confirmed'
    WHERE booking.landlord_user_id = actor_id OR booking.cleaner_user_id = actor_id
    ORDER BY sort_rank, future_start ASC NULLS LAST, past_start DESC NULLS LAST, booking.id
    LIMIT maximum_results
  ) item;

  RETURN summaries;
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.list_my_booking_summaries(integer) FROM PUBLIC;

COMMIT;
