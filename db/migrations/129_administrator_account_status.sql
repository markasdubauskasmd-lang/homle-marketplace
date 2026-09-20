-- Give somebody the ability to suspend an account.
--
-- `users.account_status` has existed since migration 001 and is enforced in
-- forty-five places: login refuses a non-active account, the session lookup
-- joins on it so a suspended person's next request stops resolving, and
-- settlement refuses to act as a non-active platform account. The enforcement
-- is thorough and it is completely unreachable -- nothing in this codebase can
-- set the column. So if a Cleaner behaves badly in somebody's home, or an
-- account is taken over, there is no way to stop them. The lock is fitted and
-- there is no key.
--
-- This adds the key, with the guards that make handing it over reasonable.
--
-- Only `active` and `suspended`. The column also permits `deletion-pending`
-- and `deleted`, and those stay out of reach here on purpose: erasure is a
-- reviewed operation, a hard delete is impossible anyway (twenty-seven foreign
-- keys refuse it), and the retention policy it needs is still a founder
-- decision. A suspension is reversible; the other two are not, and a screen
-- that can do both invites the wrong one.
--
-- The guards:
--
--   * An Administrator cannot suspend themselves. Locking yourself out of the
--     only screen that can unlock you is a mistake nobody recovers from in the
--     moment.
--   * The last active Administrator cannot be suspended. Otherwise two
--     Administrators can lock each other out, or one can end the platform's
--     ability to administer itself with a single click.
--   * A reason is required and recorded. Suspending somebody's livelihood is
--     not an anonymous act, and "why" is the first question asked afterwards.
--   * Live sessions are revoked in the same transaction. The session lookup
--     would already refuse them, but leaving rows that only fail on use means
--     "suspended" and "signed out" can disagree, and the safer of the two
--     should not depend on a join nobody re-reads.
--
-- It reports the account's live booking count rather than acting on it.
-- Suspending a Cleaner who has a job tomorrow leaves a customer expecting
-- somebody who will not arrive; cancelling those automatically is a money and
-- notification decision, not a side effect. The number is returned so the
-- decision is made with it in view.

BEGIN;

CREATE FUNCTION tideway_private.set_account_status_as_administrator(
  target_user_id uuid,
  next_status text,
  supplied_reason text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  account users%ROWTYPE;
  normalized_status text := lower(btrim(next_status));
  trimmed_reason text := NULLIF(btrim(supplied_reason), '');
  previous_status text;
  revoked_sessions integer := 0;
  live_bookings integer := 0;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  IF normalized_status NOT IN ('active','suspended') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-account-status';
  END IF;
  IF trimmed_reason IS NULL OR char_length(trimmed_reason) < 10 OR char_length(trimmed_reason) > 1000 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='account-status-reason-required';
  END IF;

  SELECT * INTO account FROM users WHERE id = target_user_id FOR UPDATE;
  IF account.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='account-not-found';
  END IF;
  -- An account already on its way out is not something to quietly reactivate
  -- from this screen.
  IF account.account_status IN ('deletion-pending','deleted') THEN
    RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='account-status-not-changeable';
  END IF;

  IF normalized_status = 'suspended' THEN
    IF account.id = actor_id THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='cannot-suspend-self';
    END IF;
    -- The last active Administrator stays. Without this, the platform can lose
    -- the ability to administer itself in one click.
    IF EXISTS (SELECT 1 FROM user_roles WHERE user_id = account.id AND role = 'administrator')
      AND (SELECT count(*) FROM user_roles administrators
             JOIN users administrator ON administrator.id = administrators.user_id
             WHERE administrators.role = 'administrator' AND administrator.account_status = 'active') <= 1 THEN
      RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='last-administrator-protected';
    END IF;
  END IF;

  previous_status := account.account_status;

  -- Repeating is not an error, but it must not look like a change either: the
  -- audit trail should not fill with re-suspensions of an already suspended
  -- account.
  IF previous_status = normalized_status THEN
    SELECT count(*) INTO live_bookings FROM bookings booking
      WHERE (booking.landlord_user_id = account.id OR booking.cleaner_user_id = account.id)
        AND booking.status IN ('pending-cleaner-acceptance','confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review');
    RETURN jsonb_build_object(
      'accountId', account.id, 'accountStatus', account.account_status, 'previousStatus', previous_status,
      'changed', false, 'revokedSessions', 0, 'liveBookings', live_bookings
    );
  END IF;

  UPDATE users SET account_status = normalized_status, updated_at = now() WHERE id = account.id
    RETURNING * INTO account;

  IF normalized_status = 'suspended' THEN
    DELETE FROM sessions WHERE user_id = account.id;
    GET DIAGNOSTICS revoked_sessions = ROW_COUNT;
  END IF;

  SELECT count(*) INTO live_bookings FROM bookings booking
    WHERE (booking.landlord_user_id = account.id OR booking.cleaner_user_id = account.id)
      AND booking.status IN ('pending-cleaner-acceptance','confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review');

  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (
      actor_id,
      'account-status-changed',
      'user',
      account.id::text,
      jsonb_build_object(
        'fromStatus', previous_status,
        'toStatus', normalized_status,
        'reason', trimmed_reason,
        'revokedSessions', revoked_sessions,
        'liveBookings', live_bookings
      )
    );

  RETURN jsonb_build_object(
    'accountId', account.id, 'accountStatus', account.account_status, 'previousStatus', previous_status,
    'changed', true, 'revokedSessions', revoked_sessions, 'liveBookings', live_bookings
  );
END;
$$;

-- Finding the account. Deliberately narrow: an exact email or an id, not a
-- browsable directory of everybody who has ever signed up. An Administrator
-- suspending an account already knows who they are looking for, and a free
-- text search over every customer is a different feature with a different
-- privacy question behind it.
CREATE FUNCTION tideway_private.find_account_for_administrator(supplied_identifier text)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
  account users%ROWTYPE;
  identifier text := btrim(supplied_identifier);
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  IF identifier IS NULL OR char_length(identifier) < 3 OR char_length(identifier) > 320 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-account-identifier';
  END IF;

  IF identifier ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    SELECT * INTO account FROM users WHERE id = identifier::uuid;
  ELSE
    SELECT * INTO account FROM users WHERE email = identifier::citext;
  END IF;
  IF account.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='account-not-found';
  END IF;

  RETURN jsonb_build_object(
    'accountId', account.id,
    'email', account.email,
    'displayName', account.display_name,
    'accountStatus', account.account_status,
    'emailVerifiedAt', account.email_verified_at,
    'createdAt', account.created_at,
    'roles', COALESCE((SELECT jsonb_agg(role ORDER BY role) FROM user_roles WHERE user_id = account.id), '[]'::jsonb),
    'liveBookings', (
      SELECT count(*) FROM bookings booking
      WHERE (booking.landlord_user_id = account.id OR booking.cleaner_user_id = account.id)
        AND booking.status IN ('pending-cleaner-acceptance','confirmed','cleaner-en-route','cleaner-arrived','cleaning-in-progress','awaiting-review')
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.set_account_status_as_administrator(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.find_account_for_administrator(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tideway_private.set_account_status_as_administrator(uuid,text,text) TO tideway_app;
GRANT EXECUTE ON FUNCTION tideway_private.find_account_for_administrator(text) TO tideway_app;

COMMIT;
