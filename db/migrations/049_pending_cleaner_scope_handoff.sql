BEGIN;

-- An invited Cleaner must see the exact Landlord-approved room checklist before
-- accepting.  Photo access remains independently consent-bound, and this
-- projection never includes the property address, access instructions, contact
-- details, Landlord identity, budget, customer price or internal matching data.
CREATE OR REPLACE FUNCTION tideway_private.get_cleaning_request_scan(target_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  request_record cleaning_requests%ROWTYPE;
  actor_is_owner_or_admin boolean:=false;
  actor_has_confirmed_booking boolean:=false;
  actor_has_pending_invitation boolean:=false;
  photos jsonb:='[]'::jsonb;
  tasks jsonb:='[]'::jsonb;
BEGIN
  IF actor_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='authentication-required';
  END IF;

  SELECT * INTO request_record FROM cleaning_requests request WHERE request.id=target_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-not-found';
  END IF;

  actor_is_owner_or_admin:=request_record.landlord_user_id=actor_id OR tideway_private.has_role('administrator');
  SELECT EXISTS(
    SELECT 1 FROM bookings booking
    WHERE booking.cleaning_request_id=request_record.id AND booking.cleaner_user_id=actor_id
      AND booking.status IN ('confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review','completed')
  ) INTO actor_has_confirmed_booking;
  SELECT EXISTS(
    SELECT 1 FROM bookings booking
    WHERE booking.cleaning_request_id=request_record.id AND booking.cleaner_user_id=actor_id
      AND booking.status='pending-cleaner-acceptance'
  ) INTO actor_has_pending_invitation;

  IF NOT (actor_is_owner_or_admin OR actor_has_confirmed_booking OR actor_has_pending_invitation) THEN
    RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='request-not-found';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'roomName',task.room_name,
    'description',task.description,
    'sortOrder',task.sort_order
  ) ORDER BY task.sort_order,task.id),'[]'::jsonb)
  INTO tasks
  FROM cleaning_request_tasks task
  WHERE task.cleaning_request_id=request_record.id;

  IF actor_is_owner_or_admin OR actor_has_confirmed_booking OR (actor_has_pending_invitation AND request_record.cleaner_preview_authorized) THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'photoId',photo.id,
      'roomName',photo.room_name,
      'note',photo.note,
      'mimeType',photo.mime_type,
      'byteSize',photo.byte_size,
      'width',photo.width_pixels,
      'height',photo.height_pixels,
      'createdAt',photo.created_at
    ) ORDER BY photo.created_at,photo.id),'[]'::jsonb)
    INTO photos
    FROM cleaning_request_photos photo
    WHERE photo.cleaning_request_id=request_record.id AND photo.sanitized_at IS NOT NULL;
  END IF;

  RETURN jsonb_build_object(
    'cleaningRequestId',request_record.id,
    'status',request_record.status,
    'tasks',tasks,
    'photos',photos,
    'cleanerPreviewAuthorized',request_record.cleaner_preview_authorized,
    'scopeConfirmedAt',request_record.customer_scope_confirmed_at
  );
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.get_cleaning_request_scan(uuid) FROM PUBLIC;

COMMIT;
