-- Execute the Administrator's account suspension.
--
-- `users.account_status` was enforced in forty-five places and settable from
-- nowhere: the lock was fitted and there was no key. Migration 129 adds the
-- key, and the guards that make handing it over reasonable are inside the
-- function, so they are asserted here by running it.
--
-- Written for a disposable database with every migration applied. Creates its
-- own fixtures and rolls back.

BEGIN;

DO $$
DECLARE
  first_admin_id uuid;
  second_admin_id uuid;
  cleaner_id uuid;
  outcome jsonb;
  found jsonb;
  remaining integer;
  refused boolean;
BEGIN
  INSERT INTO users (email, display_name, account_status)
    VALUES ('status-admin-one@verification.invalid', 'Administrator One', 'active') RETURNING id INTO first_admin_id;
  INSERT INTO users (email, display_name, account_status)
    VALUES ('status-cleaner@verification.invalid', 'Suspendable Cleaner', 'active') RETURNING id INTO cleaner_id;
  INSERT INTO user_roles (user_id, role) VALUES (first_admin_id, 'administrator'), (cleaner_id, 'cleaner');

  PERFORM set_config('app.user_id', first_admin_id::text, true);
  PERFORM set_config('app.user_roles', 'administrator', true);

  -- A reason is required. Suspending somebody's livelihood is not anonymous.
  refused := false;
  BEGIN
    PERFORM tideway_private.set_account_status_as_administrator(cleaner_id, 'suspended', 'too short');
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'account-status-reason-required' THEN RAISE; END IF;
    refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'an account was suspended without a recorded reason'; END IF;

  -- Only active and suspended. Deletion stays out of reach: it is a reviewed
  -- operation and it is not reversible.
  refused := false;
  BEGIN
    PERFORM tideway_private.set_account_status_as_administrator(cleaner_id, 'deleted', 'Attempting a deletion from the suspension screen.');
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'invalid-account-status' THEN RAISE; END IF;
    refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'an account was deleted from the suspension path'; END IF;

  -- An Administrator cannot lock themselves out of the only screen that can
  -- unlock them.
  refused := false;
  BEGIN
    PERFORM tideway_private.set_account_status_as_administrator(first_admin_id, 'suspended', 'Attempting to suspend my own account.');
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'cannot-suspend-self' THEN RAISE; END IF;
    refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'an Administrator suspended themselves'; END IF;

  -- The last active Administrator stays, so the platform cannot lose the
  -- ability to administer itself in one click.
  INSERT INTO users (email, display_name, account_status)
    VALUES ('status-admin-two@verification.invalid', 'Administrator Two', 'active') RETURNING id INTO second_admin_id;
  INSERT INTO user_roles (user_id, role) VALUES (second_admin_id, 'administrator');
  PERFORM set_config('app.user_id', second_admin_id::text, true);
  BEGIN
    PERFORM tideway_private.set_account_status_as_administrator(first_admin_id, 'suspended', 'Suspending the other administrator account.');
  EXCEPTION WHEN raise_exception THEN
    RAISE EXCEPTION 'suspending one of two Administrators was refused: %', SQLERRM;
  END;
  PERFORM set_config('app.user_id', first_admin_id::text, true);
  refused := false;
  BEGIN
    PERFORM tideway_private.set_account_status_as_administrator(second_admin_id, 'suspended', 'Suspending the final administrator account.');
  EXCEPTION WHEN others THEN
    IF SQLERRM <> 'last-administrator-protected' THEN RAISE; END IF;
    refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'the last active Administrator was suspended'; END IF;

  -- The ordinary case: a Cleaner is suspended, their sessions are revoked in
  -- the same transaction, and the change is audited with its reason.
  PERFORM set_config('app.user_id', second_admin_id::text, true);
  INSERT INTO sessions (user_id, token_hash, csrf_secret_hash, expires_at)
    VALUES (cleaner_id, repeat('a', 32)::bytea, repeat('b', 32)::bytea, now() + interval '1 hour');
  outcome := tideway_private.set_account_status_as_administrator(cleaner_id, 'suspended', 'Reported conduct in a customer home; account paused pending review.');
  IF outcome->>'changed' <> 'true' OR outcome->>'accountStatus' <> 'suspended' THEN
    RAISE EXCEPTION 'the Cleaner was not suspended: %', outcome;
  END IF;
  IF (outcome->>'revokedSessions')::integer < 1 THEN
    RAISE EXCEPTION 'suspending an account left its live sessions in place: %', outcome;
  END IF;
  SELECT count(*) INTO remaining FROM sessions WHERE user_id = cleaner_id;
  IF remaining <> 0 THEN
    RAISE EXCEPTION 'a suspended account kept % session rows', remaining;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM audit_logs
    WHERE action = 'account-status-changed' AND resource_id = cleaner_id::text
      AND metadata->>'toStatus' = 'suspended' AND metadata->>'reason' LIKE 'Reported conduct%'
  ) THEN
    RAISE EXCEPTION 'suspending an account was not audited with its reason';
  END IF;

  -- Repeating is not an error, and must not look like a change either.
  outcome := tideway_private.set_account_status_as_administrator(cleaner_id, 'suspended', 'Repeating the same suspension decision.');
  IF outcome->>'changed' <> 'false' THEN
    RAISE EXCEPTION 'a repeated suspension was recorded as a change: %', outcome;
  END IF;

  -- And it is reversible, which is why deletion is not offered here.
  outcome := tideway_private.set_account_status_as_administrator(cleaner_id, 'active', 'Review concluded; account restored.');
  IF outcome->>'changed' <> 'true' OR outcome->>'accountStatus' <> 'active' THEN
    RAISE EXCEPTION 'a suspended account could not be restored: %', outcome;
  END IF;

  -- Finding the account: an exact email or id, never a browsable directory.
  found := tideway_private.find_account_for_administrator('status-cleaner@verification.invalid');
  IF found->>'accountId' <> cleaner_id::text OR found->>'accountStatus' <> 'active' THEN
    RAISE EXCEPTION 'the account lookup returned the wrong record: %', found;
  END IF;
  IF NOT (found->'roles' @> '["cleaner"]'::jsonb) THEN
    RAISE EXCEPTION 'the account lookup lost the account roles: %', found;
  END IF;
  refused := false;
  BEGIN
    PERFORM tideway_private.find_account_for_administrator('nobody@verification.invalid');
  EXCEPTION WHEN no_data_found THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'an unknown address reported an account'; END IF;

  -- Nobody but an Administrator, on either function.
  PERFORM set_config('app.user_id', cleaner_id::text, true);
  PERFORM set_config('app.user_roles', 'cleaner', true);
  refused := false;
  BEGIN
    PERFORM tideway_private.set_account_status_as_administrator(second_admin_id, 'suspended', 'A Cleaner attempting to suspend an Administrator.');
  EXCEPTION WHEN insufficient_privilege THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'a Cleaner suspended an account'; END IF;
  refused := false;
  BEGIN
    PERFORM tideway_private.find_account_for_administrator('status-admin-two@verification.invalid');
  EXCEPTION WHEN insufficient_privilege THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'a Cleaner looked up another account'; END IF;

  RAISE NOTICE 'Account status verification passed: reason required, deletion out of reach, self and last-Administrator protected, sessions revoked, audited, idempotent, reversible, and Administrator-only.';
END $$;

ROLLBACK;
