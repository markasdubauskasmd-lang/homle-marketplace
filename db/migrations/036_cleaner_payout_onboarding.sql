BEGIN;

CREATE TABLE tideway_private.cleaner_payout_onboarding (
  cleaner_user_id uuid PRIMARY KEY REFERENCES cleaner_profiles(user_id) ON DELETE RESTRICT,
  request_id uuid NOT NULL UNIQUE,
  provider text NOT NULL CHECK (provider = 'stripe'),
  destination_account_id text UNIQUE CHECK (destination_account_id IS NULL OR destination_account_id ~ '^acct_[A-Za-z0-9_]{3,250}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION tideway_private.get_my_cleaner_payout_onboarding()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('cleaner') THEN NULL
    ELSE COALESCE((
      SELECT jsonb_build_object(
        'requestId', onboarding.request_id,
        'provider', onboarding.provider,
        'destinationAccountId', onboarding.destination_account_id,
        'chargesEnabled', COALESCE(account.charges_enabled, false),
        'payoutsEnabled', COALESCE(account.payouts_enabled, false),
        'detailsSubmitted', COALESCE(account.details_submitted, false),
        'updatedAt', COALESCE(account.updated_at, onboarding.updated_at)
      )
      FROM tideway_private.cleaner_payout_onboarding onboarding
      LEFT JOIN tideway_private.cleaner_payout_accounts account
        ON account.cleaner_user_id = onboarding.cleaner_user_id
       AND account.destination_account_id = onboarding.destination_account_id
      WHERE onboarding.cleaner_user_id = tideway_private.current_user_id()
    ), jsonb_build_object(
      'requestId', NULL,
      'provider', 'stripe',
      'destinationAccountId', NULL,
      'chargesEnabled', false,
      'payoutsEnabled', false,
      'detailsSubmitted', false,
      'updatedAt', NULL
    ))
  END;
$$;

CREATE FUNCTION tideway_private.begin_my_cleaner_payout_onboarding(supplied_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  selected tideway_private.cleaner_payout_onboarding%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='cleaner-required';
  END IF;
  IF supplied_request_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-payout-onboarding'; END IF;
  PERFORM 1 FROM cleaner_profiles profile JOIN users account ON account.id=profile.user_id
  WHERE profile.user_id=actor_id AND account.account_status='active' FOR UPDATE OF profile;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='cleaner-account-unavailable'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(actor_id::text || ':payout-onboarding', 36));
  SELECT * INTO selected FROM tideway_private.cleaner_payout_onboarding WHERE cleaner_user_id=actor_id;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM tideway_private.cleaner_payout_onboarding WHERE request_id=supplied_request_id) THEN
      RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='payout-onboarding-id-reused';
    END IF;
    INSERT INTO tideway_private.cleaner_payout_onboarding(cleaner_user_id,request_id,provider)
    VALUES(actor_id,supplied_request_id,'stripe') RETURNING * INTO selected;
    INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
    VALUES(actor_id,'cleaner-payout-onboarding.started','cleaner_payout_onboarding',selected.request_id::text,jsonb_build_object('provider','stripe'));
  END IF;
  RETURN jsonb_build_object(
    'requestId',selected.request_id,
    'provider',selected.provider,
    'destinationAccountId',selected.destination_account_id
  );
END;
$$;

CREATE FUNCTION tideway_private.attach_my_cleaner_payout_account(
  supplied_request_id uuid,
  supplied_destination_account_id text
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  selected tideway_private.cleaner_payout_onboarding%ROWTYPE;
  was_attached boolean;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='cleaner-required'; END IF;
  IF supplied_request_id IS NULL OR supplied_destination_account_id !~ '^acct_[A-Za-z0-9_]{3,250}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-payout-onboarding';
  END IF;
  SELECT * INTO selected FROM tideway_private.cleaner_payout_onboarding
  WHERE cleaner_user_id=actor_id AND request_id=supplied_request_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='payout-onboarding-not-found'; END IF;
  IF selected.destination_account_id IS NOT NULL AND selected.destination_account_id<>supplied_destination_account_id THEN
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='payout-account-conflict';
  END IF;
  was_attached := selected.destination_account_id IS NULL;
  IF EXISTS (SELECT 1 FROM tideway_private.cleaner_payout_accounts account
             WHERE account.destination_account_id=supplied_destination_account_id AND account.cleaner_user_id<>actor_id) THEN
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='payout-account-conflict';
  END IF;

  UPDATE tideway_private.cleaner_payout_onboarding
  SET destination_account_id=supplied_destination_account_id,updated_at=now()
  WHERE cleaner_user_id=actor_id;
  INSERT INTO tideway_private.cleaner_payout_accounts(cleaner_user_id,provider,destination_account_id)
  VALUES(actor_id,'stripe',supplied_destination_account_id)
  ON CONFLICT (cleaner_user_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM tideway_private.cleaner_payout_accounts account
                 WHERE account.cleaner_user_id=actor_id AND account.destination_account_id=supplied_destination_account_id) THEN
    RAISE EXCEPTION USING ERRCODE='23505', MESSAGE='payout-account-conflict';
  END IF;
  IF was_attached THEN
    INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
    VALUES(actor_id,'cleaner-payout-account.attached','cleaner_payout_onboarding',selected.request_id::text,jsonb_build_object('provider','stripe'));
  END IF;
  RETURN tideway_private.get_my_cleaner_payout_onboarding();
END;
$$;

CREATE FUNCTION tideway_private.sync_my_cleaner_payout_account(
  supplied_destination_account_id text,
  supplied_charges_enabled boolean,
  supplied_payouts_enabled boolean,
  supplied_details_submitted boolean
)
RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  prior tideway_private.cleaner_payout_accounts%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='cleaner-required'; END IF;
  SELECT account.* INTO prior FROM tideway_private.cleaner_payout_accounts account
  WHERE account.cleaner_user_id=actor_id AND account.provider='stripe' AND account.destination_account_id=supplied_destination_account_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='payout-onboarding-not-found'; END IF;
  UPDATE tideway_private.cleaner_payout_accounts SET
    charges_enabled=supplied_charges_enabled,
    payouts_enabled=supplied_payouts_enabled,
    details_submitted=supplied_details_submitted,
    updated_at=now()
  WHERE cleaner_user_id=actor_id;
  UPDATE tideway_private.cleaner_payout_onboarding SET updated_at=now() WHERE cleaner_user_id=actor_id;
  IF prior.charges_enabled IS DISTINCT FROM supplied_charges_enabled
     OR prior.payouts_enabled IS DISTINCT FROM supplied_payouts_enabled
     OR prior.details_submitted IS DISTINCT FROM supplied_details_submitted THEN
    INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
    VALUES(actor_id,'cleaner-payout-account.status-synced','cleaner_payout_onboarding',
      (SELECT request_id::text FROM tideway_private.cleaner_payout_onboarding WHERE cleaner_user_id=actor_id),
      jsonb_build_object('chargesEnabled',supplied_charges_enabled,'payoutsEnabled',supplied_payouts_enabled,'detailsSubmitted',supplied_details_submitted));
  END IF;
  RETURN tideway_private.get_my_cleaner_payout_onboarding();
END;
$$;

REVOKE ALL ON TABLE tideway_private.cleaner_payout_onboarding FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_my_cleaner_payout_onboarding() FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.begin_my_cleaner_payout_onboarding(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.attach_my_cleaner_payout_account(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.sync_my_cleaner_payout_account(text,boolean,boolean,boolean) FROM PUBLIC;

COMMIT;
