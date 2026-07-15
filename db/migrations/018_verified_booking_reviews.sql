BEGIN;

ALTER TABLE reviews
  ADD CONSTRAINT reviews_written_content_check CHECK(written_review IS NULL OR char_length(trim(written_review)) BETWEEN 1 AND 3000),
  ADD CONSTRAINT reviews_moderation_evidence_check CHECK(
    (moderation_status='pending' AND moderated_by IS NULL AND moderated_at IS NULL)
    OR (moderation_status='approved' AND moderated_by IS NOT NULL AND moderated_at IS NOT NULL)
    OR (moderation_status='rejected' AND moderated_by IS NOT NULL AND moderated_at IS NOT NULL AND moderation_note IS NOT NULL AND char_length(trim(moderation_note)) BETWEEN 1 AND 2000)
  ),
  ADD CONSTRAINT reviews_response_evidence_check CHECK(
    (cleaner_response IS NULL AND cleaner_responded_at IS NULL)
    OR (cleaner_response IS NOT NULL AND char_length(trim(cleaner_response)) BETWEEN 1 AND 2000 AND cleaner_responded_at IS NOT NULL)
  );

ALTER FUNCTION enforce_completed_booking_review() SET search_path=public,pg_temp;
ALTER FUNCTION refresh_cleaner_rating() SET search_path=public,pg_temp;

CREATE FUNCTION tideway_private.public_review_text_allowed(proposed_text text,maximum_length integer)
RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT proposed_text IS NOT NULL
    AND maximum_length BETWEEN 1 AND 3000
    AND char_length(trim(proposed_text)) BETWEEN 1 AND maximum_length
    AND replace(replace(proposed_text,E'\n',''),E'\t','') !~ '[[:cntrl:]]'
    AND proposed_text !~* '[[:alnum:]._%+\-]+@[[:alnum:].\-]+\.[[:alpha:]]{2,}'
    AND proposed_text !~* '(https?://|www\.)'
    AND proposed_text !~* '(^|[^[:alnum:]])(\+?44|0)[[:space:]().\-]*[1-9]([[:space:]().\-]*[0-9]){8,10}([^0-9]|$)'
    AND proposed_text !~* '\m(whatsapp|telegram|signal|instagram|facebook|snapchat)\M'
$$;

CREATE FUNCTION refresh_cleaner_completed_job_count() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path=public,pg_temp AS $$
DECLARE affected_cleaner uuid;
BEGIN
  affected_cleaner:=CASE WHEN TG_OP='DELETE' THEN OLD.cleaner_user_id ELSE NEW.cleaner_user_id END;
  UPDATE cleaner_profiles profile SET completed_job_count=(
    SELECT count(*) FROM bookings booking WHERE booking.cleaner_user_id=affected_cleaner AND booking.completed_at IS NOT NULL
  ),updated_at=now() WHERE profile.user_id=affected_cleaner;
  IF TG_OP='UPDATE' AND OLD.cleaner_user_id IS DISTINCT FROM NEW.cleaner_user_id THEN
    UPDATE cleaner_profiles profile SET completed_job_count=(
      SELECT count(*) FROM bookings booking WHERE booking.cleaner_user_id=OLD.cleaner_user_id AND booking.completed_at IS NOT NULL
    ),updated_at=now() WHERE profile.user_id=OLD.cleaner_user_id;
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER bookings_refresh_cleaner_completed_jobs
AFTER INSERT OR UPDATE OF completed_at,cleaner_user_id OR DELETE ON bookings
FOR EACH ROW EXECUTE FUNCTION refresh_cleaner_completed_job_count();

CREATE OR REPLACE FUNCTION tideway_private.safe_notification_payload(input_payload jsonb)
RETURNS jsonb
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'bookingId',input_payload->'bookingId',
    'responseDeadline',input_payload->'responseDeadline',
    'matchingReopened',input_payload->'matchingReopened',
    'taskId',input_payload->'taskId',
    'decision',input_payload->'decision',
    'photoId',input_payload->'photoId',
    'messageId',input_payload->'messageId',
    'reviewId',input_payload->'reviewId',
    'senderRole',input_payload->'senderRole',
    'eventId',input_payload->'eventId'
  ))
$$;

CREATE OR REPLACE FUNCTION tideway_private.queue_email_for_in_app_notification() RETURNS trigger
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF NEW.channel='in-app' AND NEW.event_type IN (
    'new-booking-request','cleaner-declined','booking-confirmed','cleaner-invitation-expired',
    'cleaner-started-travelling','cleaner-nearby','cleaner-arrived','cleaning-started',
    'cleaning-paused','cleaning-resumed','cleaning-progress-update','issue-reported',
    'job-photo-added','issue-photo-added','unexpected-task-approval-requested',
    'unexpected-task-decision','cleaning-completed','booking-completed','review-requested',
    'review-submitted','booking-message'
  ) THEN
    INSERT INTO notifications(recipient_user_id,booking_id,event_type,channel,payload,idempotency_key)
    VALUES(NEW.recipient_user_id,NEW.booking_id,NEW.event_type,'email',tideway_private.safe_notification_payload(NEW.payload),'email:'||NEW.idempotency_key)
    ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION tideway_private.confirm_booking_completion(target_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); booking_record bookings%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND booking.landlord_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='booking-not-found'; END IF;
  IF booking_record.status='completed' AND booking_record.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('bookingId',booking_record.id,'status',booking_record.status,'completedAt',booking_record.completed_at);
  END IF;
  IF booking_record.status<>'awaiting-review' OR booking_record.cleaning_finished_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='booking-not-ready-for-completion'; END IF;
  UPDATE bookings SET status='completed',completed_at=now(),updated_at=now() WHERE id=booking_record.id RETURNING * INTO booking_record;
  INSERT INTO booking_status_history(booking_id,from_status,to_status,changed_by,reason) VALUES(booking_record.id,'awaiting-review','completed',actor_id,'Landlord confirmed the finished cleaning visit.');
  INSERT INTO notifications(recipient_user_id,booking_id,event_type,channel,payload,idempotency_key)
    VALUES(booking_record.cleaner_user_id,booking_record.id,'booking-completed','in-app',jsonb_build_object('bookingId',booking_record.id),'booking:'||booking_record.id||':completed') ON CONFLICT(idempotency_key) DO NOTHING;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
    VALUES(actor_id,'booking-completion-confirmed','booking',booking_record.id::text,jsonb_build_object('cleanerUserId',booking_record.cleaner_user_id));
  RETURN jsonb_build_object('bookingId',booking_record.id,'status',booking_record.status,'completedAt',booking_record.completed_at);
END;
$$;

CREATE FUNCTION tideway_private.submit_booking_review(target_booking_id uuid,proposed_review_id uuid,overall_rating smallint,quality_score smallint,punctuality_score smallint,communication_score smallint,professionalism_score smallint,supplied_written_review text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); booking_record bookings%ROWTYPE; review_record reviews%ROWTYPE; normalized_written text:=NULLIF(trim(supplied_written_review),'');
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required'; END IF;
  IF proposed_review_id IS NULL OR overall_rating IS NULL OR overall_rating NOT BETWEEN 1 AND 5
    OR (quality_score IS NOT NULL AND quality_score NOT BETWEEN 1 AND 5)
    OR (punctuality_score IS NOT NULL AND punctuality_score NOT BETWEEN 1 AND 5)
    OR (communication_score IS NOT NULL AND communication_score NOT BETWEEN 1 AND 5)
    OR (professionalism_score IS NOT NULL AND professionalism_score NOT BETWEEN 1 AND 5)
    OR (normalized_written IS NOT NULL AND NOT tideway_private.public_review_text_allowed(normalized_written,3000)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-booking-review'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND booking.landlord_user_id=actor_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='booking-not-found'; END IF;
  IF booking_record.status<>'completed' OR booking_record.completed_at IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='review-requires-completed-booking'; END IF;
  SELECT * INTO review_record FROM reviews review WHERE review.booking_id=booking_record.id FOR UPDATE;
  IF FOUND THEN
    IF review_record.rating=overall_rating AND review_record.quality_rating IS NOT DISTINCT FROM quality_score
      AND review_record.punctuality_rating IS NOT DISTINCT FROM punctuality_score
      AND review_record.communication_rating IS NOT DISTINCT FROM communication_score
      AND review_record.professionalism_rating IS NOT DISTINCT FROM professionalism_score
      AND review_record.written_review IS NOT DISTINCT FROM normalized_written THEN
      RETURN jsonb_build_object('reviewId',review_record.id,'bookingId',review_record.booking_id,'cleanerId',review_record.cleaner_user_id,'rating',review_record.rating,'qualityRating',review_record.quality_rating,'punctualityRating',review_record.punctuality_rating,'communicationRating',review_record.communication_rating,'professionalismRating',review_record.professionalism_rating,'writtenReview',review_record.written_review,'moderationStatus',review_record.moderation_status,'createdAt',review_record.created_at);
    END IF;
    RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='review-already-submitted';
  END IF;
  INSERT INTO reviews(id,booking_id,landlord_user_id,cleaner_user_id,rating,quality_rating,punctuality_rating,communication_rating,professionalism_rating,written_review)
    VALUES(proposed_review_id,booking_record.id,actor_id,booking_record.cleaner_user_id,overall_rating,quality_score,punctuality_score,communication_score,professionalism_score,normalized_written) RETURNING * INTO review_record;
  INSERT INTO notifications(recipient_user_id,booking_id,event_type,channel,payload,idempotency_key)
    VALUES(booking_record.cleaner_user_id,booking_record.id,'review-submitted','in-app',jsonb_build_object('bookingId',booking_record.id,'reviewId',review_record.id),'review:'||review_record.id||':submitted') ON CONFLICT(idempotency_key) DO NOTHING;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
    VALUES(actor_id,'booking-review-submitted','review',review_record.id::text,jsonb_build_object('bookingId',booking_record.id,'rating',overall_rating));
  RETURN jsonb_build_object('reviewId',review_record.id,'bookingId',review_record.booking_id,'cleanerId',review_record.cleaner_user_id,'rating',review_record.rating,'qualityRating',review_record.quality_rating,'punctualityRating',review_record.punctuality_rating,'communicationRating',review_record.communication_rating,'professionalismRating',review_record.professionalism_rating,'writtenReview',review_record.written_review,'moderationStatus',review_record.moderation_status,'createdAt',review_record.created_at);
EXCEPTION WHEN unique_violation THEN
  SELECT * INTO review_record FROM reviews review WHERE review.booking_id=target_booking_id;
  IF FOUND AND review_record.rating=overall_rating AND review_record.quality_rating IS NOT DISTINCT FROM quality_score
    AND review_record.punctuality_rating IS NOT DISTINCT FROM punctuality_score
    AND review_record.communication_rating IS NOT DISTINCT FROM communication_score
    AND review_record.professionalism_rating IS NOT DISTINCT FROM professionalism_score
    AND review_record.written_review IS NOT DISTINCT FROM normalized_written THEN
    RETURN jsonb_build_object('reviewId',review_record.id,'bookingId',review_record.booking_id,'cleanerId',review_record.cleaner_user_id,'rating',review_record.rating,'qualityRating',review_record.quality_rating,'punctualityRating',review_record.punctuality_rating,'communicationRating',review_record.communication_rating,'professionalismRating',review_record.professionalism_rating,'writtenReview',review_record.written_review,'moderationStatus',review_record.moderation_status,'createdAt',review_record.created_at);
  END IF;
  RAISE EXCEPTION USING ERRCODE='23505',MESSAGE='review-already-submitted';
END;
$$;

CREATE FUNCTION tideway_private.get_booking_review(target_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); booking_record bookings%ROWTYPE; review_record reviews%ROWTYPE; is_admin boolean:=tideway_private.has_role('administrator');
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication-required'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND (booking.landlord_user_id=actor_id OR booking.cleaner_user_id=actor_id OR is_admin);
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='booking-not-found'; END IF;
  SELECT * INTO review_record FROM reviews review WHERE review.booking_id=booking_record.id;
  IF NOT FOUND OR (actor_id=booking_record.cleaner_user_id AND NOT is_admin AND review_record.moderation_status<>'approved') THEN RETURN NULL; END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object('reviewId',review_record.id,'bookingId',review_record.booking_id,'cleanerId',review_record.cleaner_user_id,'rating',review_record.rating,'qualityRating',review_record.quality_rating,'punctualityRating',review_record.punctuality_rating,'communicationRating',review_record.communication_rating,'professionalismRating',review_record.professionalism_rating,'writtenReview',review_record.written_review,'moderationStatus',review_record.moderation_status,'moderationNote',CASE WHEN actor_id=booking_record.landlord_user_id OR is_admin THEN review_record.moderation_note ELSE NULL END,'cleanerResponse',review_record.cleaner_response,'cleanerRespondedAt',review_record.cleaner_responded_at,'createdAt',review_record.created_at));
END;
$$;

CREATE FUNCTION tideway_private.get_public_cleaner_reviews(target_cleaner_id uuid,before_created_at timestamptz DEFAULT NULL,before_review_id uuid DEFAULT NULL,page_limit integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF page_limit IS NULL OR page_limit NOT BETWEEN 1 AND 50 OR ((before_created_at IS NULL)<>(before_review_id IS NULL)) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-review-cursor'; END IF;
  IF NOT EXISTS(SELECT 1 FROM cleaner_profiles profile JOIN users account ON account.id=profile.user_id WHERE profile.user_id=target_cleaner_id AND profile.is_public AND account.account_status='active') THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='cleaner-not-found'; END IF;
  WITH selected AS (
    SELECT review.id,review.rating,review.quality_rating,review.punctuality_rating,review.communication_rating,review.professionalism_rating,review.written_review,review.cleaner_response,review.cleaner_responded_at,review.created_at
    FROM reviews review WHERE review.cleaner_user_id=target_cleaner_id AND review.moderation_status='approved'
      AND (before_created_at IS NULL OR (review.created_at,review.id)<(before_created_at,before_review_id))
    ORDER BY review.created_at DESC,review.id DESC LIMIT page_limit+1
  ), page AS (SELECT * FROM selected ORDER BY created_at DESC,id DESC LIMIT page_limit)
  SELECT jsonb_build_object(
    'cleanerId',target_cleaner_id,
    'reviews',COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('reviewId',page.id,'rating',page.rating,'qualityRating',page.quality_rating,'punctualityRating',page.punctuality_rating,'communicationRating',page.communication_rating,'professionalismRating',page.professionalism_rating,'writtenReview',page.written_review,'cleanerResponse',page.cleaner_response,'cleanerRespondedAt',page.cleaner_responded_at,'createdAt',page.created_at)) ORDER BY page.created_at DESC,page.id DESC) FROM page),'[]'::jsonb),
    'hasMore',(SELECT count(*)>page_limit FROM selected),
    'nextCursor',CASE WHEN (SELECT count(*)>page_limit FROM selected) THEN (SELECT jsonb_build_object('beforeCreatedAt',page.created_at,'beforeReviewId',page.id) FROM page ORDER BY page.created_at,page.id LIMIT 1) ELSE NULL END
  ) INTO result;
  RETURN result;
END;
$$;

CREATE FUNCTION tideway_private.respond_to_booking_review(target_booking_id uuid,supplied_response text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); booking_record bookings%ROWTYPE; review_record reviews%ROWTYPE; normalized_response text:=NULLIF(trim(supplied_response),'');
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='cleaner-required'; END IF;
  IF normalized_response IS NULL OR NOT tideway_private.public_review_text_allowed(normalized_response,2000) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-review-response'; END IF;
  SELECT * INTO booking_record FROM bookings booking WHERE booking.id=target_booking_id AND booking.cleaner_user_id=actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='booking-not-found'; END IF;
  SELECT * INTO review_record FROM reviews review WHERE review.booking_id=booking_record.id AND review.moderation_status='approved' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='approved-review-not-found'; END IF;
  IF review_record.cleaner_response IS NOT NULL THEN
    IF review_record.cleaner_response=normalized_response THEN RETURN tideway_private.get_booking_review(booking_record.id); END IF;
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='review-response-final';
  END IF;
  UPDATE reviews SET cleaner_response=normalized_response,cleaner_responded_at=now(),updated_at=now() WHERE id=review_record.id;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata) VALUES(actor_id,'review-response-submitted','review',review_record.id::text,jsonb_build_object('bookingId',booking_record.id));
  RETURN tideway_private.get_booking_review(booking_record.id);
END;
$$;

CREATE FUNCTION tideway_private.moderate_booking_review(target_review_id uuid,supplied_decision text,supplied_note text)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); review_record reviews%ROWTYPE; normalized_note text:=NULLIF(trim(supplied_note),''); prior_status review_moderation_status;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='administrator-required'; END IF;
  IF supplied_decision IS NULL OR supplied_decision NOT IN('approved','rejected') OR char_length(COALESCE(normalized_note,''))>2000 OR (supplied_decision='rejected' AND normalized_note IS NULL) THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-review-moderation'; END IF;
  SELECT * INTO review_record FROM reviews review WHERE review.id=target_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='review-not-found'; END IF;
  IF review_record.moderation_status::text=supplied_decision AND review_record.moderation_note IS NOT DISTINCT FROM normalized_note THEN RETURN tideway_private.get_booking_review(review_record.booking_id); END IF;
  prior_status:=review_record.moderation_status;
  UPDATE reviews SET moderation_status=supplied_decision::review_moderation_status,moderation_note=normalized_note,moderated_by=actor_id,moderated_at=now(),updated_at=now() WHERE id=review_record.id;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata) VALUES(actor_id,'review-moderated','review',review_record.id::text,jsonb_build_object('bookingId',review_record.booking_id,'fromStatus',prior_status,'toStatus',supplied_decision));
  RETURN tideway_private.get_booking_review(review_record.booking_id);
END;
$$;

REVOKE ALL ON FUNCTION refresh_cleaner_completed_job_count() FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.public_review_text_allowed(text,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.confirm_booking_completion(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.submit_booking_review(uuid,uuid,smallint,smallint,smallint,smallint,smallint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_booking_review(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_public_cleaner_reviews(uuid,timestamptz,uuid,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.respond_to_booking_review(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.moderate_booking_review(uuid,text,text) FROM PUBLIC;

COMMIT;
