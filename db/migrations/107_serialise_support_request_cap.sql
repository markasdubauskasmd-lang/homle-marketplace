-- The five-open-support-request cap leaked under concurrency.
--
-- Both creators read `count(*) … WHERE status IN ('open','reviewing') >= 5` and
-- then inserted, at READ COMMITTED, with no lock and no database constraint
-- behind it. That is a check-then-insert race: every concurrent transaction sees
-- the same pre-insert count and every one of them passes. Measured against an
-- account with one open request: eight concurrent posts, **five accepted where
-- four slots remained**, leaving six open.
--
-- The cap is per account, so it is serialised per account: a transaction-scoped
-- advisory lock keyed on the actor, taken inline in both creators. Two requests from the same account queue;
-- requests from different accounts never contend, so this costs nothing at
-- scale. `pg_advisory_xact_lock` releases at commit or rollback, so no path can
-- leak the lock.
--
-- The lock is taken BEFORE the idempotency read, not just before the count, so
-- it fixes a second race in the same place: `create_landlord_support_request`
-- read by `client_request_id`, found nothing, and inserted — so a double-click
-- or a retry-after-timeout had both transactions miss and the second hit the
-- unique index. That surfaced as a 500 until the error mapping was fixed, and
-- as a spurious 409 after. Now the second waits, sees the first, and returns it.
-- `create_landlord_booking_change_request` already had the ON CONFLICT recovery;
-- it is kept, because the lock makes it unreachable rather than unnecessary and
-- belt-and-braces is the right posture on an idempotency key.
BEGIN;

CREATE OR REPLACE FUNCTION tideway_private.create_landlord_support_request(
  proposed_support_request_id uuid,
  proposed_client_request_id uuid,
  supplied_category text,
  supplied_subject text,
  supplied_description text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  normalized_category text:=lower(trim(supplied_category));
  normalized_subject text:=trim(supplied_subject);
  normalized_description text:=trim(supplied_description);
  request_record support_requests%ROWTYPE;
  combined_text text;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM users account WHERE account.id=actor_id AND account.account_status='active') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account-inactive';
  END IF;
  combined_text:=normalized_subject||E'\n'||normalized_description;
  IF proposed_support_request_id IS NULL OR proposed_client_request_id IS NULL
    OR normalized_category NOT IN ('account-access','property','room-scan','booking-preparation','other')
    OR char_length(normalized_subject) NOT BETWEEN 10 AND 120
    OR char_length(normalized_description) NOT BETWEEN 20 AND 2000
    OR replace(replace(combined_text,E'\n',''),E'\t','') ~ '[[:cntrl:]]'
    OR combined_text ~* '(password|passcode|door[[:space:]-]?code|alarm[[:space:]-]?code|key[[:space:]-]?safe|api[[:space:]-]?key|secret[[:space:]-]?key|card[[:space:]-]?number|cvv|cvc)'
    -- A card-like sequence may contain spaces or hyphens. Do not reject an
    -- otherwise harmless collection of dates, booking references and room
    -- numbers spread throughout the request.
    OR combined_text ~ '([0-9][[:space:]-]?){13,19}' THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-support-request';
  END IF;

  -- Everything below this line is one account's slot arithmetic. Serialise it.
  -- Inlined rather than factored into a helper: a separate SECURITY DEFINER
  -- function is owned by whichever role ran the migration, and these two are
  -- owned by homle_owner, so the inner call was refused with "permission denied
  -- for function". The key string is asserted identical in both creators by
  -- tests/support-request-cap.mjs, which is what a shared helper was for.
  PERFORM pg_advisory_xact_lock(hashtextextended('tideway:support-request-cap:'||actor_id::text,0));

  SELECT * INTO request_record FROM support_requests request
    WHERE request.account_id=actor_id AND request.client_request_id=proposed_client_request_id;
  IF FOUND THEN RETURN tideway_private.support_request_result(request_record); END IF;

  IF (SELECT count(*) FROM support_requests request
      WHERE request.account_id=actor_id AND request.status IN ('open','reviewing')) >= 5 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='support-request-limit';
  END IF;

  INSERT INTO support_requests(id,account_id,client_request_id,category,subject,description)
    VALUES(proposed_support_request_id,actor_id,proposed_client_request_id,normalized_category,normalized_subject,normalized_description)
    ON CONFLICT ON CONSTRAINT support_requests_retry_idempotency DO NOTHING
    RETURNING * INTO request_record;
  -- Unreachable while the lock holds, and kept anyway: an idempotency key must
  -- never turn a retry into a fault, whatever else changes around it.
  IF NOT FOUND THEN
    SELECT * INTO request_record FROM support_requests request
      WHERE request.account_id=actor_id AND request.client_request_id=proposed_client_request_id;
    IF FOUND THEN RETURN tideway_private.support_request_result(request_record); END IF;
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='support-request-limit';
  END IF;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,request_id,metadata)
    VALUES(actor_id,'landlord-support-request-created','support_request',request_record.id::text,proposed_client_request_id,
      jsonb_build_object('category',request_record.category,'status',request_record.status));
  RETURN tideway_private.support_request_result(request_record);
END;
$$;

CREATE OR REPLACE FUNCTION tideway_private.create_landlord_booking_change_request(
  proposed_support_request_id uuid,
  proposed_client_request_id uuid,
  target_booking_id uuid,
  supplied_change_kind text,
  supplied_proposed_start_at timestamptz,
  supplied_description text
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid:=tideway_private.current_user_id();
  normalized_kind text:=lower(trim(supplied_change_kind));
  normalized_description text:=trim(supplied_description);
  booking_record bookings%ROWTYPE;
  request_record support_requests%ROWTYPE;
  generated_subject text;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='landlord-required';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM users account WHERE account.id=actor_id AND account.account_status='active') THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='account-inactive';
  END IF;

  -- As above: one account's slot arithmetic, serialised. Taken before the
  -- idempotency read so a retry cannot race its own original. The key must stay
  -- byte-identical to the one in create_landlord_support_request or the two
  -- stop excluding each other; tests/support-request-cap.mjs asserts that.
  PERFORM pg_advisory_xact_lock(hashtextextended('tideway:support-request-cap:'||actor_id::text,0));

  -- An exact retry must remain safe even if the booking moved on while the
  -- client waited for a response.
  SELECT * INTO request_record FROM support_requests request
    WHERE request.account_id=actor_id AND request.client_request_id=proposed_client_request_id;
  IF FOUND THEN RETURN tideway_private.support_request_result(request_record); END IF;

  IF proposed_support_request_id IS NULL OR proposed_client_request_id IS NULL OR target_booking_id IS NULL
    OR normalized_kind NOT IN ('reschedule','cancel')
    OR char_length(normalized_description) NOT BETWEEN 20 AND 2000
    OR replace(replace(normalized_description,E'\n',''),E'\t','') ~ '[[:cntrl:]]'
    OR normalized_description ~* '(password|passcode|door[[:space:]-]?code|alarm[[:space:]-]?code|key[[:space:]-]?safe|api[[:space:]-]?key|secret[[:space:]-]?key|card[[:space:]-]?number|cvv|cvc)'
    OR normalized_description ~ '([0-9][[:space:]-]?){13,19}'
    OR (normalized_kind='reschedule' AND (
      supplied_proposed_start_at IS NULL
      OR supplied_proposed_start_at<=now()
      OR supplied_proposed_start_at>now()+interval '365 days'))
    OR (normalized_kind='cancel' AND supplied_proposed_start_at IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-booking-change-request';
  END IF;

  SELECT * INTO booking_record FROM bookings booking
    WHERE booking.id=target_booking_id AND booking.landlord_user_id=actor_id
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='booking-not-found'; END IF;
  IF booking_record.status<>'confirmed' OR booking_record.scheduled_start_at<=now() THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='booking-change-not-requestable';
  END IF;
  IF normalized_kind='reschedule' AND supplied_proposed_start_at=booking_record.scheduled_start_at THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-booking-change-request';
  END IF;
  IF EXISTS(SELECT 1 FROM support_requests request
      WHERE request.account_id=actor_id AND request.related_booking_id=target_booking_id
        AND request.category='booking-change' AND request.status IN ('open','reviewing')) THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='booking-change-already-open';
  END IF;
  IF (SELECT count(*) FROM support_requests request
      WHERE request.account_id=actor_id AND request.status IN ('open','reviewing'))>=5 THEN
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='support-request-limit';
  END IF;

  generated_subject:=CASE normalized_kind
    WHEN 'reschedule' THEN 'Request to reschedule confirmed booking'
    ELSE 'Request to cancel confirmed booking'
  END;
  INSERT INTO support_requests(
    id,account_id,client_request_id,category,subject,description,
    related_booking_id,booking_change_kind,proposed_start_at
  ) VALUES(
    proposed_support_request_id,actor_id,proposed_client_request_id,'booking-change',generated_subject,normalized_description,
    target_booking_id,normalized_kind,CASE WHEN normalized_kind='reschedule' THEN supplied_proposed_start_at ELSE NULL END
  ) ON CONFLICT ON CONSTRAINT support_requests_retry_idempotency DO NOTHING
    RETURNING * INTO request_record;
  -- A concurrent retry may pass the early read before the first transaction
  -- commits. Return that exact request without creating a second audit entry.
  IF NOT FOUND THEN
    SELECT * INTO request_record FROM support_requests request
      WHERE request.account_id=actor_id AND request.client_request_id=proposed_client_request_id;
    IF FOUND THEN RETURN tideway_private.support_request_result(request_record); END IF;
    RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='booking-change-already-open';
  END IF;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,request_id,metadata)
    VALUES(actor_id,'landlord-booking-change-request-created','support_request',request_record.id::text,proposed_client_request_id,
      jsonb_build_object('bookingId',target_booking_id,'changeKind',normalized_kind,'status',request_record.status));
  RETURN tideway_private.support_request_result(request_record);
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION USING ERRCODE='P0001',MESSAGE='booking-change-already-open';
END;
$$;

COMMIT;
