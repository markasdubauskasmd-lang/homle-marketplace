BEGIN;

ALTER TABLE cleaning_tasks
  ADD COLUMN unexpected_estimated_minutes integer CHECK (unexpected_estimated_minutes BETWEEN 1 AND 480),
  ADD CONSTRAINT cleaning_tasks_unexpected_estimate_check CHECK ((unexpected AND unexpected_estimated_minutes IS NOT NULL) OR (NOT unexpected AND unexpected_estimated_minutes IS NULL));

CREATE TABLE job_pauses (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  paused_by uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 1000),
  paused_at timestamptz NOT NULL DEFAULT now(),
  resumed_by uuid REFERENCES users(id),
  resume_note text CHECK (char_length(resume_note) <= 1000),
  resumed_at timestamptz,
  CHECK ((resumed_at IS NULL AND resumed_by IS NULL) OR (resumed_at IS NOT NULL AND resumed_by IS NOT NULL AND resumed_at >= paused_at))
);
CREATE UNIQUE INDEX job_pauses_one_open_per_booking_idx ON job_pauses(booking_id) WHERE resumed_at IS NULL;
CREATE INDEX job_pauses_booking_idx ON job_pauses(booking_id, paused_at);

CREATE TABLE unexpected_task_decisions (
  task_id uuid PRIMARY KEY REFERENCES cleaning_tasks(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  landlord_user_id uuid NOT NULL REFERENCES landlord_profiles(user_id),
  decision text NOT NULL CHECK (decision IN ('approved', 'declined')),
  price_unchanged_confirmed boolean NOT NULL,
  note text CHECK (char_length(note) <= 1000),
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX unexpected_task_decisions_booking_idx ON unexpected_task_decisions(booking_id, decided_at);

CREATE TABLE booking_progress_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  actor_user_id uuid NOT NULL REFERENCES users(id),
  event_type text NOT NULL CHECK (event_type IN ('cleaning-started', 'job-paused', 'job-resumed', 'task-updated', 'issue-reported', 'unexpected-task-added', 'unexpected-task-approved', 'unexpected-task-declined', 'cleaning-finished')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX booking_progress_events_booking_idx ON booking_progress_events(booking_id, id);

ALTER TABLE job_pauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE unexpected_task_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_progress_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY job_pauses_participants ON job_pauses USING (tideway_private.booking_participant(booking_id));
CREATE POLICY unexpected_task_decisions_participants ON unexpected_task_decisions USING (tideway_private.booking_participant(booking_id));
CREATE POLICY booking_progress_events_participants ON booking_progress_events USING (tideway_private.booking_participant(booking_id));

CREATE FUNCTION tideway_private.get_cleaning_progress(target_booking_id uuid)
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
      'unexpected', task.unexpected, 'unexpectedEstimatedMinutes', task.unexpected_estimated_minutes, 'landlordApprovalStatus', task.landlord_approval_status,
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

CREATE FUNCTION tideway_private.start_booking_cleaning(target_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id(); booking_record bookings%ROWTYPE; event_id bigint;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='cleaner-required'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND booking.cleaner_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='booking-not-found'; END IF;
  IF booking_record.status='cleaning-in-progress' THEN RETURN tideway_private.get_cleaning_progress(booking_record.id); END IF;
  IF booking_record.status<>'cleaner-arrived' OR booking_record.arrived_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='cleaning-not-startable'; END IF;
  IF now() < booking_record.scheduled_start_at - interval '30 minutes' OR now() > booking_record.scheduled_end_at + interval '4 hours' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='cleaning-outside-safe-window'; END IF;
  UPDATE bookings SET status='cleaning-in-progress', cleaning_started_at=now(), updated_at=now() WHERE id=booking_record.id;
  INSERT INTO booking_status_history (booking_id, from_status, to_status, changed_by, reason) VALUES (booking_record.id, 'cleaner-arrived', 'cleaning-in-progress', actor_id, 'Cleaner started cleaning.') ;
  INSERT INTO booking_progress_events (booking_id, actor_user_id, event_type) VALUES (booking_record.id, actor_id, 'cleaning-started') RETURNING id INTO event_id;
  INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key) VALUES (booking_record.landlord_user_id, booking_record.id, 'cleaning-started', 'in-app', jsonb_build_object('bookingId', booking_record.id, 'eventId', event_id), 'progress:' || event_id) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN tideway_private.get_cleaning_progress(booking_record.id);
END;
$$;

CREATE FUNCTION tideway_private.set_booking_cleaning_pause(target_booking_id uuid, should_pause boolean, supplied_note text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id(); booking_record bookings%ROWTYPE; open_pause job_pauses%ROWTYPE; event_id bigint; normalized_note text := NULLIF(trim(supplied_note), '');
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='cleaner-required'; END IF;
  IF should_pause IS NULL OR char_length(COALESCE(normalized_note,''))>1000 OR (should_pause AND normalized_note IS NULL) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-pause'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND booking.cleaner_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='booking-not-found'; END IF;
  IF booking_record.status<>'cleaning-in-progress' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='cleaning-not-active'; END IF;
  SELECT * INTO open_pause FROM job_pauses pause WHERE pause.booking_id=booking_record.id AND pause.resumed_at IS NULL FOR UPDATE;
  IF should_pause THEN
    IF open_pause.id IS NOT NULL THEN RETURN tideway_private.get_cleaning_progress(booking_record.id); END IF;
    INSERT INTO job_pauses (booking_id, paused_by, reason) VALUES (booking_record.id, actor_id, normalized_note);
    INSERT INTO booking_progress_events (booking_id, actor_user_id, event_type, payload) VALUES (booking_record.id, actor_id, 'job-paused', jsonb_build_object('reason', normalized_note)) RETURNING id INTO event_id;
  ELSE
    IF open_pause.id IS NULL THEN RETURN tideway_private.get_cleaning_progress(booking_record.id); END IF;
    UPDATE job_pauses SET resumed_by=actor_id, resumed_at=now(), resume_note=normalized_note WHERE id=open_pause.id;
    INSERT INTO booking_progress_events (booking_id, actor_user_id, event_type, payload) VALUES (booking_record.id, actor_id, 'job-resumed', jsonb_build_object('note', normalized_note)) RETURNING id INTO event_id;
  END IF;
  INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key) VALUES (booking_record.landlord_user_id, booking_record.id, CASE WHEN should_pause THEN 'cleaning-paused' ELSE 'cleaning-resumed' END, 'in-app', jsonb_build_object('bookingId', booking_record.id, 'eventId', event_id), 'progress:' || event_id) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN tideway_private.get_cleaning_progress(booking_record.id);
END;
$$;

CREATE FUNCTION tideway_private.update_booking_cleaning_task(target_booking_id uuid, target_task_id uuid, requested_status text, supplied_note text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id(); booking_record bookings%ROWTYPE; task_record cleaning_tasks%ROWTYPE; normalized_note text := NULLIF(trim(supplied_note), ''); event_id bigint;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='cleaner-required'; END IF;
  IF requested_status IS NULL OR requested_status NOT IN ('not-started','in-progress','completed','skipped','issue-reported') OR char_length(COALESCE(normalized_note,''))>2000 OR (requested_status IN ('skipped','issue-reported') AND normalized_note IS NULL) THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-task-update'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND booking.cleaner_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='booking-not-found'; END IF;
  IF booking_record.status<>'cleaning-in-progress' OR EXISTS (SELECT 1 FROM job_pauses pause WHERE pause.booking_id=booking_record.id AND pause.resumed_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='cleaning-not-active'; END IF;
  SELECT * INTO task_record FROM cleaning_tasks task WHERE task.id=target_task_id AND task.booking_id=booking_record.id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='task-not-found'; END IF;
  IF task_record.unexpected AND task_record.landlord_approval_status IS DISTINCT FROM 'approved' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='unexpected-task-not-approved'; END IF;
  IF task_record.status::text=requested_status AND normalized_note IS NULL THEN RETURN tideway_private.get_cleaning_progress(booking_record.id); END IF;
  UPDATE cleaning_tasks SET status=requested_status::cleaning_task_status, updated_at=now() WHERE id=task_record.id;
  INSERT INTO task_updates (task_id, booking_id, actor_user_id, from_status, to_status, note) VALUES (task_record.id, booking_record.id, actor_id, task_record.status, requested_status::cleaning_task_status, normalized_note);
  INSERT INTO booking_progress_events (booking_id, actor_user_id, event_type, payload) VALUES (booking_record.id, actor_id, CASE WHEN requested_status='issue-reported' THEN 'issue-reported' ELSE 'task-updated' END, jsonb_build_object('taskId', task_record.id, 'fromStatus', task_record.status, 'toStatus', requested_status, 'note', normalized_note)) RETURNING id INTO event_id;
  INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key) VALUES (booking_record.landlord_user_id, booking_record.id, CASE WHEN requested_status='issue-reported' THEN 'issue-reported' ELSE 'cleaning-progress-update' END, 'in-app', jsonb_build_object('bookingId', booking_record.id, 'taskId', task_record.id, 'eventId', event_id), 'progress:' || event_id) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN tideway_private.get_cleaning_progress(booking_record.id);
END;
$$;

CREATE FUNCTION tideway_private.add_unexpected_cleaning_task(target_booking_id uuid, supplied_room_name text, supplied_description text, supplied_estimated_minutes integer, supplied_note text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id(); booking_record bookings%ROWTYPE; new_task_id uuid; event_id bigint; room_name text:=trim(supplied_room_name); description text:=trim(supplied_description); note text:=NULLIF(trim(supplied_note),'');
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='cleaner-required'; END IF;
  IF room_name IS NULL OR description IS NULL OR supplied_estimated_minutes IS NULL OR char_length(room_name) NOT BETWEEN 1 AND 120 OR char_length(description) NOT BETWEEN 1 AND 1000 OR supplied_estimated_minutes NOT BETWEEN 1 AND 480 OR char_length(COALESCE(note,''))>2000 THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-unexpected-task'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND booking.cleaner_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='booking-not-found'; END IF;
  IF booking_record.status<>'cleaning-in-progress' OR EXISTS (SELECT 1 FROM job_pauses pause WHERE pause.booking_id=booking_record.id AND pause.resumed_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='cleaning-not-active'; END IF;
  INSERT INTO cleaning_tasks (booking_id, room_name, description, unexpected, unexpected_estimated_minutes, landlord_approval_status, sort_order) VALUES (booking_record.id, room_name, description, true, supplied_estimated_minutes, 'pending', COALESCE((SELECT max(task.sort_order)+1 FROM cleaning_tasks task WHERE task.booking_id=booking_record.id),0)) RETURNING id INTO new_task_id;
  INSERT INTO task_updates (task_id, booking_id, actor_user_id, from_status, to_status, note) VALUES (new_task_id, booking_record.id, actor_id, NULL, 'not-started', note);
  INSERT INTO booking_progress_events (booking_id, actor_user_id, event_type, payload) VALUES (booking_record.id, actor_id, 'unexpected-task-added', jsonb_build_object('taskId',new_task_id,'roomName',room_name,'description',description,'estimatedAdditionalMinutes',supplied_estimated_minutes,'priceChange',false,'note',note)) RETURNING id INTO event_id;
  INSERT INTO notifications (recipient_user_id, booking_id, event_type, channel, payload, idempotency_key) VALUES (booking_record.landlord_user_id, booking_record.id, 'unexpected-task-approval-requested', 'in-app', jsonb_build_object('bookingId',booking_record.id,'taskId',new_task_id,'eventId',event_id), 'progress:' || event_id) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN tideway_private.get_cleaning_progress(booking_record.id);
END;
$$;

CREATE FUNCTION tideway_private.decide_unexpected_cleaning_task(target_booking_id uuid, target_task_id uuid, supplied_decision text, supplied_price_unchanged_confirmation boolean, supplied_note text)
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
  INSERT INTO unexpected_task_decisions (task_id,booking_id,landlord_user_id,decision,price_unchanged_confirmed,note) VALUES (task_record.id,booking_record.id,actor_id,supplied_decision,COALESCE(supplied_price_unchanged_confirmation,false),normalized_note);
  UPDATE cleaning_tasks SET landlord_approval_status=supplied_decision, status=CASE WHEN supplied_decision='declined' THEN 'skipped'::cleaning_task_status ELSE status END, updated_at=now() WHERE id=task_record.id;
  IF supplied_decision='declined' THEN INSERT INTO task_updates (task_id,booking_id,actor_user_id,from_status,to_status,note) VALUES (task_record.id,booking_record.id,actor_id,task_record.status,'skipped',COALESCE(normalized_note,'Landlord declined unexpected task.')); END IF;
  INSERT INTO booking_progress_events (booking_id,actor_user_id,event_type,payload) VALUES (booking_record.id,actor_id,CASE WHEN supplied_decision='approved' THEN 'unexpected-task-approved' ELSE 'unexpected-task-declined' END,jsonb_build_object('taskId',task_record.id,'decision',supplied_decision,'priceUnchangedConfirmed',COALESCE(supplied_price_unchanged_confirmation,false),'note',normalized_note)) RETURNING id INTO event_id;
  INSERT INTO notifications (recipient_user_id,booking_id,event_type,channel,payload,idempotency_key) VALUES (booking_record.cleaner_user_id,booking_record.id,'unexpected-task-decision','in-app',jsonb_build_object('bookingId',booking_record.id,'taskId',task_record.id,'decision',supplied_decision,'eventId',event_id),'progress:' || event_id) ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN tideway_private.get_cleaning_progress(booking_record.id);
END;
$$;

CREATE FUNCTION tideway_private.finish_booking_cleaning(target_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); booking_record bookings%ROWTYPE; event_id bigint;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='cleaner-required'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND booking.cleaner_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='booking-not-found'; END IF;
  IF booking_record.status='awaiting-review' THEN RETURN tideway_private.get_cleaning_progress(booking_record.id); END IF;
  IF booking_record.status<>'cleaning-in-progress' OR EXISTS (SELECT 1 FROM job_pauses pause WHERE pause.booking_id=booking_record.id AND pause.resumed_at IS NULL) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='cleaning-not-finishable'; END IF;
  IF EXISTS (SELECT 1 FROM cleaning_tasks task WHERE task.booking_id=booking_record.id AND (task.status NOT IN ('completed','skipped','issue-reported') OR (task.unexpected AND task.landlord_approval_status='pending'))) THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='cleaning-tasks-unresolved'; END IF;
  UPDATE bookings SET status='awaiting-review', cleaning_finished_at=now(), updated_at=now() WHERE id=booking_record.id;
  INSERT INTO booking_status_history (booking_id,from_status,to_status,changed_by,reason) VALUES (booking_record.id,'cleaning-in-progress','awaiting-review',actor_id,'Cleaner finished the cleaning checklist.');
  INSERT INTO booking_progress_events (booking_id,actor_user_id,event_type) VALUES (booking_record.id,actor_id,'cleaning-finished') RETURNING id INTO event_id;
  INSERT INTO notifications (recipient_user_id,booking_id,event_type,channel,payload,idempotency_key) VALUES (booking_record.landlord_user_id,booking_record.id,'cleaning-completed','in-app',jsonb_build_object('bookingId',booking_record.id,'eventId',event_id),'progress:' || event_id) ON CONFLICT (idempotency_key) DO NOTHING;
  INSERT INTO notifications (recipient_user_id,booking_id,event_type,channel,payload,idempotency_key) VALUES (booking_record.landlord_user_id,booking_record.id,'review-requested','in-app',jsonb_build_object('bookingId',booking_record.id),'booking:' || booking_record.id || ':review-requested') ON CONFLICT (idempotency_key) DO NOTHING;
  RETURN tideway_private.get_cleaning_progress(booking_record.id);
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.get_cleaning_progress(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.start_booking_cleaning(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.set_booking_cleaning_pause(uuid,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.update_booking_cleaning_task(uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.add_unexpected_cleaning_task(uuid,text,text,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.decide_unexpected_cleaning_task(uuid,uuid,text,boolean,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.finish_booking_cleaning(uuid) FROM PUBLIC;

COMMIT;
