BEGIN;

ALTER TABLE cleaning_tasks
  ADD COLUMN frozen_terms_confirmed_by_cleaner boolean NOT NULL DEFAULT false,
  ADD COLUMN frozen_terms_confirmed_at timestamptz,
  ADD CONSTRAINT cleaning_tasks_frozen_terms_confirmation_check CHECK (
    (NOT frozen_terms_confirmed_by_cleaner AND frozen_terms_confirmed_at IS NULL) OR
    (unexpected AND frozen_terms_confirmed_by_cleaner AND frozen_terms_confirmed_at IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION tideway_private.get_cleaning_progress(target_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  snapshot jsonb;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication-required'; END IF;
  SELECT jsonb_build_object(
    'bookingId', booking.id,
    'status', booking.status,
    'scheduledStartAt', booking.scheduled_start_at,
    'cleaningStartedAt', booking.cleaning_started_at,
    'cleaningFinishedAt', booking.cleaning_finished_at,
    'isPaused', EXISTS (SELECT 1 FROM job_pauses pause WHERE pause.booking_id=booking.id AND pause.resumed_at IS NULL),
    'elapsedSeconds', CASE WHEN booking.cleaning_started_at IS NULL THEN 0 ELSE GREATEST(0, floor(extract(epoch FROM (COALESCE(booking.cleaning_finished_at, now()) - booking.cleaning_started_at)))::integer - COALESCE((SELECT sum(floor(extract(epoch FROM (COALESCE(pause.resumed_at, COALESCE(booking.cleaning_finished_at, now())) - pause.paused_at)))::integer) FROM job_pauses pause WHERE pause.booking_id=booking.id), 0)) END,
    'totalTasks', (SELECT count(*) FROM cleaning_tasks task WHERE task.booking_id=booking.id),
    'completedTasks', (SELECT count(*) FROM cleaning_tasks task WHERE task.booking_id=booking.id AND task.status='completed'),
    'resolvedTasks', (SELECT count(*) FROM cleaning_tasks task WHERE task.booking_id=booking.id AND task.status IN ('completed', 'skipped', 'issue-reported')),
    'overallPercentage', COALESCE((SELECT round(count(*) FILTER (WHERE task.status IN ('completed', 'skipped', 'issue-reported'))::numeric * 100 / NULLIF(count(*), 0), 0) FROM cleaning_tasks task WHERE task.booking_id=booking.id), 0),
    'rooms', COALESCE((SELECT jsonb_agg(jsonb_build_object('roomName', room.room_name, 'totalTasks', room.total_tasks, 'resolvedTasks', room.resolved_tasks, 'completed', room.resolved_tasks=room.total_tasks) ORDER BY room.room_name) FROM (SELECT task.room_name, count(*)::integer total_tasks, count(*) FILTER (WHERE task.status IN ('completed', 'skipped', 'issue-reported'))::integer resolved_tasks FROM cleaning_tasks task WHERE task.booking_id=booking.id GROUP BY task.room_name) room), '[]'::jsonb),
    'tasks', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'taskId', task.id, 'roomName', task.room_name, 'description', task.description, 'status', task.status,
      'unexpected', task.unexpected, 'unexpectedEstimatedMinutes', task.unexpected_estimated_minutes,
      'cleanerFrozenTermsConfirmed', task.frozen_terms_confirmed_by_cleaner, 'cleanerFrozenTermsConfirmedAt', task.frozen_terms_confirmed_at,
      'landlordApprovalStatus', task.landlord_approval_status,
      'latestNote', latest.note, 'updatedAt', COALESCE(latest.created_at, task.updated_at), 'updatedBy', latest.actor_user_id
    ) ORDER BY task.sort_order, task.id) FROM cleaning_tasks task LEFT JOIN LATERAL (SELECT task_update.note, task_update.created_at, task_update.actor_user_id FROM task_updates task_update WHERE task_update.task_id=task.id ORDER BY task_update.id DESC LIMIT 1) latest ON true WHERE task.booking_id=booking.id), '[]'::jsonb),
    'photos', COALESCE((SELECT jsonb_agg(jsonb_build_object('photoId', photo.id, 'taskId', photo.task_id, 'photoType', photo.photo_type, 'note', photo.note, 'uploadedBy', photo.uploaded_by, 'createdAt', photo.created_at) ORDER BY photo.created_at) FROM job_photos photo WHERE photo.booking_id=booking.id), '[]'::jsonb),
    'eventVersion', COALESCE((SELECT max(event.id) FROM booking_progress_events event WHERE event.booking_id=booking.id), 0),
    'recentEvents', COALESCE((SELECT jsonb_agg(jsonb_build_object('eventId', recent.id, 'eventType', recent.event_type, 'actorUserId', recent.actor_user_id, 'payload', recent.payload, 'createdAt', recent.created_at) ORDER BY recent.id) FROM (SELECT event.* FROM booking_progress_events event WHERE event.booking_id=booking.id ORDER BY event.id DESC LIMIT 50) recent), '[]'::jsonb)
  ) INTO snapshot
  FROM bookings booking
  WHERE booking.id=target_booking_id AND (booking.landlord_user_id=actor_id OR booking.cleaner_user_id=actor_id OR tideway_private.has_role('administrator'));
  IF snapshot IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='booking-not-found'; END IF;
  RETURN snapshot;
END;
$$;

DROP FUNCTION tideway_private.add_unexpected_cleaning_task(uuid,text,text,integer,text);

CREATE FUNCTION tideway_private.add_unexpected_cleaning_task(target_booking_id uuid, supplied_room_name text, supplied_description text, supplied_estimated_minutes integer, supplied_frozen_terms_confirmation boolean, supplied_note text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id(); booking_record bookings%ROWTYPE; new_task_id uuid; event_id bigint; room_name text:=trim(supplied_room_name); description text:=trim(supplied_description); note text:=NULLIF(trim(supplied_note),'');
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='cleaner-required'; END IF;
  IF room_name IS NULL OR description IS NULL OR supplied_estimated_minutes IS NULL OR char_length(room_name) NOT BETWEEN 1 AND 120 OR char_length(description) NOT BETWEEN 1 AND 1000 OR supplied_estimated_minutes NOT BETWEEN 1 AND 480 OR supplied_frozen_terms_confirmation IS NOT TRUE OR char_length(COALESCE(note,''))>2000 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-unexpected-task'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND booking.cleaner_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='booking-not-found'; END IF;
  IF booking_record.status<>'cleaning-in-progress' OR EXISTS (SELECT 1 FROM job_pauses pause WHERE pause.booking_id=booking_record.id AND pause.resumed_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='cleaning-not-active'; END IF;
  IF clock_timestamp() + make_interval(mins => supplied_estimated_minutes) > booking_record.scheduled_end_at THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='unexpected-task-exceeds-booked-time'; END IF;
  INSERT INTO cleaning_tasks (booking_id, room_name, description, unexpected, unexpected_estimated_minutes, frozen_terms_confirmed_by_cleaner, frozen_terms_confirmed_at, landlord_approval_status, sort_order) VALUES (booking_record.id, room_name, description, true, supplied_estimated_minutes, true, now(), 'pending', COALESCE((SELECT max(task.sort_order)+1 FROM cleaning_tasks task WHERE task.booking_id=booking_record.id),0)) RETURNING id INTO new_task_id;
  INSERT INTO task_updates (task_id, booking_id, actor_user_id, from_status, to_status, note) VALUES (new_task_id, booking_record.id, actor_id, NULL, 'not-started', note);
  INSERT INTO booking_progress_events (booking_id, actor_user_id, event_type, payload) VALUES (booking_record.id, actor_id, 'unexpected-task-added', jsonb_build_object('taskId',new_task_id,'roomName',room_name,'description',description,'estimatedMinutes',supplied_estimated_minutes,'priceChange',false,'frozenTermsConfirmedByCleaner',true,'note',note)) RETURNING id INTO event_id;
  INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key) VALUES (booking_record.landlord_user_id, booking_record.id, 'unexpected-task-approval-requested', 'in-app', jsonb_build_object('bookingId',booking_record.id,'taskId',new_task_id,'eventId',event_id), 'progress:' || event_id) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN tideway_private.get_cleaning_progress(booking_record.id);
END;
$$;

CREATE FUNCTION tideway_private.confirm_unexpected_task_frozen_terms(target_booking_id uuid, target_task_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); booking_record bookings%ROWTYPE; task_record cleaning_tasks%ROWTYPE; event_id bigint;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='cleaner-required'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND booking.cleaner_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='booking-not-found'; END IF;
  IF booking_record.status<>'cleaning-in-progress' OR EXISTS (SELECT 1 FROM job_pauses pause WHERE pause.booking_id=booking_record.id AND pause.resumed_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='cleaning-not-active'; END IF;
  SELECT * INTO task_record FROM cleaning_tasks task WHERE task.id=target_task_id AND task.booking_id=booking_record.id AND task.unexpected AND task.landlord_approval_status='pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='task-not-found'; END IF;
  IF task_record.frozen_terms_confirmed_by_cleaner THEN RETURN tideway_private.get_cleaning_progress(booking_record.id); END IF;
  IF clock_timestamp() + make_interval(mins => task_record.unexpected_estimated_minutes) > booking_record.scheduled_end_at THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='unexpected-task-exceeds-booked-time'; END IF;
  UPDATE cleaning_tasks SET frozen_terms_confirmed_by_cleaner=true, frozen_terms_confirmed_at=now(), updated_at=now() WHERE id=task_record.id;
  INSERT INTO booking_progress_events (booking_id,actor_user_id,event_type,payload) VALUES (booking_record.id,actor_id,'task-updated',jsonb_build_object('taskId',task_record.id,'action','frozen-terms-confirmed','estimatedMinutes',task_record.unexpected_estimated_minutes,'priceChange',false)) RETURNING id INTO event_id;
  INSERT INTO notifications (recipient_user_id,booking_id,event_type,channel,payload,idempotency_key) VALUES (booking_record.landlord_user_id,booking_record.id,'unexpected-task-approval-requested','in-app',jsonb_build_object('bookingId',booking_record.id,'taskId',task_record.id,'eventId',event_id),'progress:' || event_id) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN tideway_private.get_cleaning_progress(booking_record.id);
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.decide_unexpected_cleaning_task(target_booking_id uuid, target_task_id uuid, supplied_decision text, supplied_price_unchanged_confirmation boolean, supplied_note text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); booking_record bookings%ROWTYPE; task_record cleaning_tasks%ROWTYPE; existing unexpected_task_decisions%ROWTYPE; normalized_note text:=NULLIF(trim(supplied_note),''); event_id bigint;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='landlord-required'; END IF;
  IF supplied_decision IS NULL OR supplied_decision NOT IN ('approved','declined') OR char_length(COALESCE(normalized_note,''))>1000 OR (supplied_decision='approved' AND supplied_price_unchanged_confirmation IS NOT TRUE) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-task-decision'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND booking.landlord_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='booking-not-found'; END IF;
  IF booking_record.status<>'cleaning-in-progress' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='cleaning-not-active'; END IF;
  SELECT * INTO task_record FROM cleaning_tasks task WHERE task.id=target_task_id AND task.booking_id=booking_record.id AND task.unexpected FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='task-not-found'; END IF;
  SELECT * INTO existing FROM unexpected_task_decisions decision WHERE decision.task_id=task_record.id;
  IF existing.task_id IS NOT NULL THEN
    IF existing.decision=supplied_decision THEN RETURN tideway_private.get_cleaning_progress(booking_record.id); END IF;
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='task-decision-final';
  END IF;
  IF supplied_decision='approved' AND NOT task_record.frozen_terms_confirmed_by_cleaner THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='unexpected-task-terms-unconfirmed'; END IF;
  IF supplied_decision='approved' AND clock_timestamp() + make_interval(mins => task_record.unexpected_estimated_minutes) > booking_record.scheduled_end_at THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='unexpected-task-exceeds-booked-time'; END IF;
  INSERT INTO unexpected_task_decisions (task_id,booking_id,landlord_user_id,decision,price_unchanged_confirmed,note) VALUES (task_record.id,booking_record.id,actor_id,supplied_decision,COALESCE(supplied_price_unchanged_confirmation,false),normalized_note);
  UPDATE cleaning_tasks SET landlord_approval_status=supplied_decision, status=CASE WHEN supplied_decision='declined' THEN 'skipped'::cleaning_task_status ELSE status END, updated_at=now() WHERE id=task_record.id;
  IF supplied_decision='declined' THEN INSERT INTO task_updates (task_id,booking_id,actor_user_id,from_status,to_status,note) VALUES (task_record.id,booking_record.id,actor_id,task_record.status,'skipped',COALESCE(normalized_note,'Landlord declined unexpected task.')); END IF;
  INSERT INTO booking_progress_events (booking_id,actor_user_id,event_type,payload) VALUES (booking_record.id,actor_id,CASE WHEN supplied_decision='approved' THEN 'unexpected-task-approved' ELSE 'unexpected-task-declined' END,jsonb_build_object('taskId',task_record.id,'decision',supplied_decision,'priceUnchangedConfirmed',COALESCE(supplied_price_unchanged_confirmation,false),'cleanerFrozenTermsConfirmed',task_record.frozen_terms_confirmed_by_cleaner,'note',normalized_note)) RETURNING id INTO event_id;
  INSERT INTO notifications (recipient_user_id,booking_id,event_type,channel,payload,idempotency_key) VALUES (booking_record.cleaner_user_id,booking_record.id,'unexpected-task-decision','in-app',jsonb_build_object('bookingId',booking_record.id,'taskId',task_record.id,'decision',supplied_decision,'eventId',event_id),'progress:' || event_id) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN tideway_private.get_cleaning_progress(booking_record.id);
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.add_unexpected_cleaning_task(uuid,text,text,integer,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.confirm_unexpected_task_frozen_terms(uuid,uuid) FROM PUBLIC;

COMMIT;
