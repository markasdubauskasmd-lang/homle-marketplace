-- A Cleaner kept access to a home's interior photographs forever.
--
-- `get_cleaning_request_photo_object` admitted a Cleaner whose booking status is
-- `completed`, with no time bound at all. So somebody who cleaned a flat once
-- could keep minting signed URLs for photographs of its inside — the kitchen,
-- the bedrooms, whatever the Landlord photographed — for as long as the record
-- existed. Nothing expired, and nothing told the Landlord it had not.
--
-- Access after the job is still needed: a dispute, a review, a Landlord asking
-- "was it like this when you arrived". Fourteen days covers that and matches the
-- window in which a booking can still be disputed. After it, a Cleaner who needs
-- a photograph asks an administrator, who still has access.
--
-- Two other statuses are bounded here for the same reason:
--   * `awaiting-review` is a terminal-ish state that a booking can sit in
--     indefinitely if nobody reviews, which would have been a way around the
--     completed bound.
--   * `pending-cleaner-acceptance` under `cleaner_preview_authorized` is the
--     PRE-acceptance preview. An invitation that is never answered should not
--     leave the photographs readable for ever, so it is bounded to the invite.
--
-- The Landlord who owns the request and an administrator are unchanged.
BEGIN;

CREATE OR REPLACE FUNCTION tideway_private.get_cleaning_request_photo_object(target_request_id uuid,target_photo_id uuid)
RETURNS TABLE(storage_key text,mime_type text,byte_size integer,checksum_hex text,room_name text,note text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid:=tideway_private.current_user_id(); request_record cleaning_requests%ROWTYPE;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication-required'; END IF;
  SELECT * INTO request_record FROM cleaning_requests request WHERE request.id=target_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-photo-not-found'; END IF;
  IF NOT (request_record.landlord_user_id=actor_id OR tideway_private.has_role('administrator') OR EXISTS (
    SELECT 1 FROM bookings booking WHERE booking.cleaning_request_id=request_record.id AND booking.cleaner_user_id=actor_id AND (
      -- The job is live. No bound: the Cleaner is standing in the property.
      booking.status IN ('confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress')
      -- The job is over. Fourteen days from the moment it ended, so a dispute or
      -- a review can still refer to what was there. A booking with no
      -- completed_at recorded is treated as expired rather than as forever.
      OR (booking.status IN ('awaiting-review','completed')
          AND booking.completed_at IS NOT NULL
          AND booking.completed_at > now() - interval '14 days')
      -- The invitation preview, bounded to the life of the invitation.
      OR (request_record.cleaner_preview_authorized
          AND booking.status='pending-cleaner-acceptance'
          AND booking.invited_at IS NOT NULL
          AND booking.invited_at > now() - interval '14 days')
    )
  )) THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-photo-not-found'; END IF;
  RETURN QUERY SELECT photo.storage_key,photo.mime_type,photo.byte_size,encode(photo.checksum_sha256,'hex'),photo.room_name,photo.note
    FROM cleaning_request_photos photo WHERE photo.id=target_photo_id AND photo.cleaning_request_id=request_record.id AND photo.sanitized_at IS NOT NULL;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-photo-not-found'; END IF;
END;
$$;

COMMIT;
