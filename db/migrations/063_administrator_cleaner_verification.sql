-- Manual cleaner vetting (v1). An Administrator can review cleaners awaiting
-- verification and set their identity and background-check status. This is the
-- trusted-side counterpart to migration 062's self-verify lock: cleaners can
-- never verify themselves, and now Administrators have an audited path to verify
-- them. An automated ID/background-check provider can later drive the same
-- set_cleaner_verification function.
BEGIN;

-- Queue of cleaners for the vetting desk: privacy-minimal — name, publish state
-- and verification status only. No contact details or addresses.
CREATE FUNCTION tideway_private.list_cleaner_verification_queue(selected_view text, page_limit integer, page_offset integer)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE result jsonb;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  IF selected_view IS NOT NULL AND selected_view NOT IN ('awaiting','verified','all') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-verification-view';
  END IF;
  IF page_limit NOT BETWEEN 1 AND 100 OR page_offset NOT BETWEEN 0 AND 10000 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-verification-page';
  END IF;

  SELECT jsonb_build_object(
    'cleaners', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'cleanerId', profile.user_id,
        'displayName', account.display_name,
        'identityCheckStatus', profile.identity_check_status,
        'backgroundCheckStatus', profile.background_check_status,
        'isPublic', profile.is_public,
        'updatedAt', profile.updated_at
      ) ORDER BY profile.updated_at DESC, profile.user_id)
      FROM cleaner_profiles profile
      JOIN users account ON account.id = profile.user_id
      WHERE account.account_status = 'active'
        AND CASE COALESCE(selected_view,'awaiting')
          WHEN 'awaiting' THEN profile.identity_check_status IN ('not-checked','pending') OR profile.background_check_status IN ('not-checked','pending')
          WHEN 'verified' THEN profile.identity_check_status = 'verified'
          ELSE true
        END
      LIMIT page_limit OFFSET page_offset
    ), '[]'::jsonb),
    'limit', page_limit,
    'offset', page_offset
  ) INTO result;
  RETURN result;
END;
$$;

-- Administrator sets a cleaner's identity and/or background check status. The
-- BEFORE UPDATE trigger from migration 062 already blocks non-Administrators;
-- this function additionally checks the role explicitly, validates the status
-- values and records an audit entry.
CREATE FUNCTION tideway_private.set_cleaner_verification(
  target_cleaner_id uuid,
  supplied_identity_status text,
  supplied_background_status text,
  supplied_note text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  updated_row cleaner_profiles%ROWTYPE;
  trimmed_note text := left(COALESCE(supplied_note,''), 500);
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  IF target_cleaner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='cleaner-required';
  END IF;
  IF supplied_identity_status IS NOT NULL AND supplied_identity_status NOT IN ('not-checked','pending','verified','failed','expired') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-identity-check-status';
  END IF;
  IF supplied_background_status IS NOT NULL AND supplied_background_status NOT IN ('not-checked','pending','verified','failed','expired','not-required') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-background-check-status';
  END IF;
  IF supplied_identity_status IS NULL AND supplied_background_status IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='no-verification-change-supplied';
  END IF;

  UPDATE cleaner_profiles SET
    identity_check_status = COALESCE(supplied_identity_status, identity_check_status),
    background_check_status = COALESCE(supplied_background_status, background_check_status),
    updated_at = now()
  WHERE user_id = target_cleaner_id
  RETURNING * INTO updated_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='cleaner-profile-not-found';
  END IF;

  INSERT INTO audit_logs(actor_user_id, action, resource_type, resource_id, metadata)
  VALUES(actor_id, 'cleaner-verification-set', 'cleaner_profile', target_cleaner_id::text,
    jsonb_build_object(
      'identityCheckStatus', updated_row.identity_check_status,
      'backgroundCheckStatus', updated_row.background_check_status,
      'note', trimmed_note
    ));

  RETURN jsonb_build_object(
    'cleanerId', updated_row.user_id,
    'identityCheckStatus', updated_row.identity_check_status,
    'backgroundCheckStatus', updated_row.background_check_status
  );
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.list_cleaner_verification_queue(text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.set_cleaner_verification(uuid,text,text,text) FROM PUBLIC;

COMMIT;
