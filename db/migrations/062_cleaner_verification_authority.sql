-- Trust-and-safety: a Cleaner's identity and background-check status must only
-- ever be changed by an Administrator. Today those columns are protected only by
-- the application update statement omitting them; the RLS owner-write policy on
-- cleaner_profiles would otherwise let a Cleaner set their own row to
-- 'verified'. This adds a database-level guard so self-verification fails closed
-- regardless of the code path. Legitimate profile edits are unaffected because
-- the guard only fires when a verification column actually changes.
BEGIN;

CREATE FUNCTION tideway_private.enforce_cleaner_verification_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (NEW.identity_check_status IS DISTINCT FROM OLD.identity_check_status
      OR NEW.background_check_status IS DISTINCT FROM OLD.background_check_status)
     AND NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'cleaner-verification-admin-only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER cleaner_verification_admin_only
  BEFORE UPDATE ON cleaner_profiles
  FOR EACH ROW
  EXECUTE FUNCTION tideway_private.enforce_cleaner_verification_authority();

REVOKE ALL ON FUNCTION tideway_private.enforce_cleaner_verification_authority() FROM PUBLIC;

COMMIT;
