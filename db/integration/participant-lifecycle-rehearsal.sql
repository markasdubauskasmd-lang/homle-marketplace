\set ON_ERROR_STOP on

BEGIN;

DO $landlord_authorization_check$
DECLARE
  selected_booking_id uuid;
BEGIN
  PERFORM set_config('app.user_id', '10000000-0000-4000-8000-000000000001', true);
  PERFORM set_config('app.user_roles', 'landlord', true);

  SELECT booking.id INTO selected_booking_id
  FROM bookings booking
  WHERE booking.id::text LIKE '40000000-0000-4000-8000-%'
    AND booking.status = 'confirmed'
  ORDER BY booking.id
  LIMIT 1;

  IF selected_booking_id IS NULL THEN RAISE EXCEPTION 'Confirmed participant rehearsal booking is missing'; END IF;

  IF NOT tideway_private.current_booking_payment_authorized(selected_booking_id) THEN
    RAISE EXCEPTION 'Synthetic current payment authorization did not unlock the local participant rehearsal';
  END IF;
END
$landlord_authorization_check$;

DO $landlord_message$
DECLARE
  selected_booking_id uuid;
  sent jsonb;
  retried jsonb;
  conflict_blocked boolean := false;
BEGIN
  PERFORM set_config('app.user_id', '10000000-0000-4000-8000-000000000001', true);
  PERFORM set_config('app.user_roles', 'landlord', true);
  SELECT booking.id INTO selected_booking_id FROM bookings booking
    WHERE booking.id::text LIKE '40000000-0000-4000-8000-%' AND booking.status='confirmed'
    ORDER BY booking.id LIMIT 1;

  sent := tideway_private.send_booking_message(
    selected_booking_id,
    '54000000-0000-4000-8000-000000000001',
    '54100000-0000-4000-8000-000000000001',
    'Please focus on the living areas.'
  );
  retried := tideway_private.send_booking_message(
    selected_booking_id,
    '54000000-0000-4000-8000-000000000002',
    '54100000-0000-4000-8000-000000000001',
    'Please focus on the living areas.'
  );
  IF sent->>'messageId'<>'54000000-0000-4000-8000-000000000001'
     OR retried->>'messageId'<>sent->>'messageId'
     OR sent->>'senderRole'<>'landlord' THEN
    RAISE EXCEPTION 'Landlord message or exact retry was not recorded once';
  END IF;
  BEGIN
    PERFORM tideway_private.send_booking_message(
      selected_booking_id,
      '54000000-0000-4000-8000-000000000002',
      '54100000-0000-4000-8000-000000000001',
      'Changed retry content.'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM<>'message-idempotency-conflict' THEN RAISE; END IF;
    conflict_blocked := true;
  END;
  IF conflict_blocked IS NOT TRUE THEN RAISE EXCEPTION 'Changed message retry was accepted'; END IF;
END
$landlord_message$;

DO $cleaner_message$
DECLARE
  selected_booking_id uuid;
  projection jsonb;
  sent jsonb;
  contact_blocked boolean := false;
BEGIN
  PERFORM set_config('app.user_id', '10000000-0000-4000-8000-000000000002', true);
  PERFORM set_config('app.user_roles', 'cleaner', true);
  SELECT booking.id INTO selected_booking_id FROM bookings booking
    WHERE booking.id::text LIKE '40000000-0000-4000-8000-%' AND booking.status='confirmed'
    ORDER BY booking.id LIMIT 1;

  projection := tideway_private.get_booking_messages(selected_booking_id,NULL,NULL,50);
  IF jsonb_array_length(projection->'messages')<>1
     OR projection->'messages'->0->>'body'<>'Please focus on the living areas.'
     OR projection->'messages'->0->>'senderRole'<>'landlord' THEN
    RAISE EXCEPTION 'Cleaner did not receive the private Landlord booking message';
  END IF;
  sent := tideway_private.send_booking_message(
    selected_booking_id,
    '54000000-0000-4000-8000-000000000003',
    '54100000-0000-4000-8000-000000000002',
    'Understood. I will update the checklist.'
  );
  IF sent->>'senderRole'<>'cleaner' THEN RAISE EXCEPTION 'Cleaner reply lost its participant role'; END IF;
  BEGIN
    PERFORM tideway_private.send_booking_message(
      selected_booking_id,
      '54000000-0000-4000-8000-000000000004',
      '54100000-0000-4000-8000-000000000003',
      'Call me on 07123456789.'
    );
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM<>'invalid-booking-message' THEN RAISE; END IF;
    contact_blocked := true;
  END;
  IF contact_blocked IS NOT TRUE THEN RAISE EXCEPTION 'Direct contact details were accepted in booking chat'; END IF;
END
$cleaner_message$;

DO $landlord_message_projection$
DECLARE selected_booking_id uuid; projection jsonb;
BEGIN
  PERFORM set_config('app.user_id', '10000000-0000-4000-8000-000000000001', true);
  PERFORM set_config('app.user_roles', 'landlord', true);
  SELECT booking.id INTO selected_booking_id FROM bookings booking
    WHERE booking.id::text LIKE '40000000-0000-4000-8000-%' AND booking.status='confirmed'
    ORDER BY booking.id LIMIT 1;
  projection := tideway_private.get_booking_messages(selected_booking_id,NULL,NULL,50);
  IF jsonb_array_length(projection->'messages')<>2
     OR projection->'messages'->1->>'body'<>'Understood. I will update the checklist.'
     OR projection->'messages'->1->>'senderRole'<>'cleaner' THEN
    RAISE EXCEPTION 'Landlord did not receive the private Cleaner booking reply';
  END IF;
END
$landlord_message_projection$;

DO $cleaner_visit$
DECLARE
  selected_booking_id uuid;
  selected_task_id uuid;
  snapshot jsonb;
BEGIN
  PERFORM set_config('app.user_id', '10000000-0000-4000-8000-000000000002', true);
  PERFORM set_config('app.user_roles', 'cleaner', true);

  SELECT booking.id INTO selected_booking_id
  FROM bookings booking
  WHERE booking.id::text LIKE '40000000-0000-4000-8000-%'
    AND booking.status = 'confirmed'
  ORDER BY booking.id
  LIMIT 1;

  PERFORM tideway_private.start_cleaner_journey(selected_booking_id, true, 51.501, -0.141, 8, NULL);
  IF NOT EXISTS (SELECT 1 FROM cleaner_locations location WHERE location.booking_id = selected_booking_id) THEN
    RAISE EXCEPTION 'Cleaner journey did not create the consent-bound current location';
  END IF;

  PERFORM tideway_private.mark_cleaner_arrived(selected_booking_id);
  IF EXISTS (SELECT 1 FROM cleaner_locations location WHERE location.booking_id = selected_booking_id) THEN
    RAISE EXCEPTION 'Cleaner arrival did not remove the current location';
  END IF;

  PERFORM tideway_private.start_booking_cleaning(selected_booking_id);
  FOR selected_task_id IN
    SELECT task.id FROM cleaning_tasks task WHERE task.booking_id = selected_booking_id ORDER BY task.sort_order, task.id
  LOOP
    PERFORM tideway_private.update_booking_cleaning_task(selected_booking_id, selected_task_id, 'completed', 'Synthetic local rehearsal task completed.');
  END LOOP;

  snapshot := tideway_private.finish_booking_cleaning(selected_booking_id);
  IF snapshot->>'status' <> 'awaiting-review'
     OR (snapshot->>'overallPercentage')::numeric <> 100
     OR (snapshot->>'completedTasks')::integer <> (snapshot->>'totalTasks')::integer THEN
    RAISE EXCEPTION 'Cleaner visit did not finish with the complete reviewed checklist';
  END IF;
END
$cleaner_visit$;

DO $landlord_completion$
DECLARE
  selected_booking_id uuid;
  completion jsonb;
  submitted jsonb;
  retried jsonb;
  duplicate_rejected boolean := false;
BEGIN
  PERFORM set_config('app.user_id', '10000000-0000-4000-8000-000000000001', true);
  PERFORM set_config('app.user_roles', 'landlord', true);

  SELECT booking.id INTO selected_booking_id
  FROM bookings booking
  WHERE booking.id::text LIKE '40000000-0000-4000-8000-%'
    AND booking.status = 'awaiting-review'
  ORDER BY booking.id
  LIMIT 1;

  completion := tideway_private.confirm_booking_completion(selected_booking_id);
  submitted := tideway_private.submit_booking_review(
    selected_booking_id,
    '53000000-0000-4000-8000-000000000001'::uuid,
    5::smallint, 5::smallint, 5::smallint, 5::smallint, 5::smallint,
    'Synthetic local rehearsal review.'
  );
  retried := tideway_private.submit_booking_review(
    selected_booking_id,
    '53000000-0000-4000-8000-000000000002'::uuid,
    5::smallint, 5::smallint, 5::smallint, 5::smallint, 5::smallint,
    'Synthetic local rehearsal review.'
  );

  IF completion->>'status' <> 'completed'
     OR submitted->>'reviewId' <> '53000000-0000-4000-8000-000000000001'
     OR retried->>'reviewId' <> submitted->>'reviewId' THEN
    RAISE EXCEPTION 'Landlord completion or retry-safe review submission failed';
  END IF;

  BEGIN
    PERFORM tideway_private.submit_booking_review(
      selected_booking_id,
      '53000000-0000-4000-8000-000000000003'::uuid,
      4::smallint, 4::smallint, 4::smallint, 4::smallint, 4::smallint,
      'Different synthetic review content.'
    );
  EXCEPTION WHEN unique_violation THEN
    IF SQLERRM <> 'review-already-submitted' THEN RAISE; END IF;
    duplicate_rejected := true;
  END;
  IF duplicate_rejected IS NOT TRUE THEN RAISE EXCEPTION 'A second different review was accepted'; END IF;
END
$landlord_completion$;

DO $pending_review_privacy$
DECLARE
  selected_booking_id uuid;
  blocked boolean := false;
BEGIN
  PERFORM set_config('app.user_id', '10000000-0000-4000-8000-000000000002', true);
  PERFORM set_config('app.user_roles', 'cleaner', true);
  SELECT booking.id INTO selected_booking_id FROM bookings booking
    WHERE booking.id::text LIKE '40000000-0000-4000-8000-%' AND booking.status = 'completed'
    ORDER BY booking.id LIMIT 1;

  IF tideway_private.get_booking_review(selected_booking_id) IS NOT NULL THEN
    RAISE EXCEPTION 'Cleaner could see an unapproved review';
  END IF;
  BEGIN
    PERFORM tideway_private.respond_to_booking_review(selected_booking_id, 'Thank you for the synthetic review.');
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM <> 'approved-review-not-found' THEN RAISE; END IF;
    blocked := true;
  END;
  IF blocked IS NOT TRUE THEN RAISE EXCEPTION 'Cleaner responded before review approval'; END IF;
END
$pending_review_privacy$;

DO $moderation_and_response$
DECLARE
  selected_booking_id uuid;
  review_projection jsonb;
BEGIN
  PERFORM set_config('app.user_id', '10000000-0000-4000-8000-000000000004', true);
  PERFORM set_config('app.user_roles', 'administrator', true);
  review_projection := tideway_private.moderate_booking_review(
    '53000000-0000-4000-8000-000000000001',
    'approved',
    NULL
  );
  IF review_projection->>'moderationStatus' <> 'approved' THEN RAISE EXCEPTION 'Administrator review approval failed'; END IF;

  PERFORM set_config('app.user_id', '10000000-0000-4000-8000-000000000002', true);
  PERFORM set_config('app.user_roles', 'cleaner', true);
  SELECT booking.id INTO selected_booking_id FROM bookings booking
    WHERE booking.id::text LIKE '40000000-0000-4000-8000-%' AND booking.status = 'completed'
    ORDER BY booking.id LIMIT 1;
  review_projection := tideway_private.get_booking_review(selected_booking_id);
  IF review_projection->>'moderationStatus' <> 'approved' OR review_projection->>'rating' <> '5' THEN
    RAISE EXCEPTION 'Cleaner could not read the approved verified review';
  END IF;
  review_projection := tideway_private.respond_to_booking_review(selected_booking_id, 'Thank you for the synthetic review.');
  IF review_projection->>'cleanerResponse' <> 'Thank you for the synthetic review.' THEN
    RAISE EXCEPTION 'Cleaner review response was not recorded';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM cleaner_profiles profile
    WHERE profile.user_id = '10000000-0000-4000-8000-000000000002'
      AND profile.average_rating = 5.00
      AND profile.review_count = 1
      AND profile.completed_job_count = 1
  ) THEN RAISE EXCEPTION 'Cleaner public rating or completed-job aggregate is incorrect'; END IF;
END
$moderation_and_response$;

DO $outsider_denial$
DECLARE
  selected_booking_id uuid;
  blocked_progress boolean := false;
  blocked_review boolean := false;
  blocked_messages boolean := false;
  blocked_send boolean := false;
BEGIN
  PERFORM set_config('app.user_id', '10000000-0000-4000-8000-000000000001', true);
  PERFORM set_config('app.user_roles', 'landlord', true);
  SELECT booking.id INTO selected_booking_id FROM bookings booking
    WHERE booking.id::text LIKE '40000000-0000-4000-8000-%' AND booking.status = 'completed'
    ORDER BY booking.id LIMIT 1;
  IF selected_booking_id IS NULL THEN RAISE EXCEPTION 'Completed participant booking is missing before outsider-denial checks'; END IF;

  PERFORM set_config('app.user_id', '10000000-0000-4000-8000-000000000003', true);
  PERFORM set_config('app.user_roles', 'landlord', true);

  BEGIN
    PERFORM tideway_private.get_cleaning_progress(selected_booking_id);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM <> 'booking-not-found' THEN RAISE; END IF;
    blocked_progress := true;
  END;
  BEGIN
    PERFORM tideway_private.get_booking_review(selected_booking_id);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM <> 'booking-not-found' THEN RAISE; END IF;
    blocked_review := true;
  END;
  BEGIN
    PERFORM tideway_private.get_booking_messages(selected_booking_id,NULL,NULL,50);
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM <> 'booking-not-found' THEN RAISE; END IF;
    blocked_messages := true;
  END;
  BEGIN
    PERFORM tideway_private.send_booking_message(
      selected_booking_id,
      '54000000-0000-4000-8000-000000000005',
      '54100000-0000-4000-8000-000000000005',
      'Synthetic outsider message.'
    );
  EXCEPTION WHEN SQLSTATE 'P0002' THEN
    IF SQLERRM <> 'booking-not-found' THEN RAISE; END IF;
    blocked_send := true;
  END;
  IF blocked_progress IS NOT TRUE OR blocked_review IS NOT TRUE OR blocked_messages IS NOT TRUE OR blocked_send IS NOT TRUE THEN
    RAISE EXCEPTION 'Unrelated account gained participant lifecycle access';
  END IF;
END
$outsider_denial$;

COMMIT;
