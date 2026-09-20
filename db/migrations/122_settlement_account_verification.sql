-- Verify the settlement account genuinely holds the administrator role.
--
-- `tideway_private.has_role` reads `app.user_roles`, which the application sets
-- verbatim from the actor object it was handed. The database therefore does NOT
-- resolve a role from the account — it trusts the caller. That is sound for a
-- request carrying a real session, because the session is what produced the
-- roles, and it is fine for every existing caller.
--
-- It is not fine for a configured background identity. Automatic settlement
-- builds its own actor from `PLATFORM_SETTLEMENT_USER_ID` and asserts the
-- administrator role in JavaScript. Nothing checked that the configured id
-- belongs to an administrator, so pasting any user's UUID — a landlord, a
-- cleaner, an old test account — would have granted that identity platform-wide
-- authority to capture and transfer every payment, and written them into
-- `payment_commands.created_by` as the audit record for the money moved.
--
-- The operator instructions claimed the opposite: that a wrong id would fail
-- safely. This function is what makes that sentence true. Settlement calls it
-- at startup and refuses to run unless the configured account really does hold
-- the role, so a mistyped or stale id stops settlement rather than quietly
-- borrowing somebody's identity to move money.
--
-- SECURITY DEFINER because the caller cannot be trusted to have permission to
-- read `user_roles` for an account that is not their own — which is precisely
-- the question being asked. It returns a boolean and never the row, so it
-- cannot be used to enumerate anybody's roles.

BEGIN;

CREATE FUNCTION tideway_private.account_holds_role(target_user_id uuid, required_role user_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_roles granted
    JOIN users account ON account.id = granted.user_id
    WHERE granted.user_id = target_user_id
      AND granted.role = required_role
      -- A suspended or deleted account must not keep settling payments.
      AND account.account_status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION tideway_private.account_holds_role(uuid, user_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tideway_private.account_holds_role(uuid, user_role) TO tideway_app;

COMMIT;
