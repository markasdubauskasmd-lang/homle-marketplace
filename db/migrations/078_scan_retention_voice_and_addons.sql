-- Three remaining pieces of the scanning feature: retention, spoken
-- instructions, and a catalogue for the add-ons the pricing engine already
-- accepts.
--
-- Grouped because they share one property: each is a place where the feature
-- currently relies on nothing happening rather than on something being enforced.
BEGIN;

/* ── Retention ──────────────────────────────────────────────────────────── */

-- A structured scan is a description of the inside of somebody's home, and until
-- now it lived for as long as the request did. Customer-initiated deletion
-- worked; time simply never removed anything.
--
-- Retention is attached to the request rather than to a global setting, because
-- a scan for a request that never became a booking has no reason to survive as
-- long as one a Cleaner worked from. Both are configurable, and both default to
-- a period an operator can shorten without a deployment.
CREATE TABLE scan_retention_policy (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  -- A scan whose request was never submitted, or was withdrawn.
  abandoned_days integer NOT NULL DEFAULT 30 CHECK (abandoned_days BETWEEN 1 AND 3650),
  -- A scan a Cleaner was actually sent to work from. Longer, because it is the
  -- evidence in any dispute about what was agreed.
  completed_days integer NOT NULL DEFAULT 730 CHECK (completed_days BETWEEN 1 AND 3650),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (completed_days >= abandoned_days)
);
INSERT INTO scan_retention_policy (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE scan_retention_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY scan_retention_policy_readable ON scan_retention_policy FOR SELECT USING (
  tideway_private.current_user_id() IS NOT NULL
);

-- Deletes scans past their retention, in bounded batches.
--
-- `FOR UPDATE SKIP LOCKED` so two workers cannot fight over the same rows, and a
-- returned count so the drain loop knows whether to keep going — the same shape
-- as every other purge in this schema.
--
-- Deliberately deletes the SESSION and lets the cascade take rooms, objects and
-- measurements. Deleting rows individually would leave a window in which a scan
-- existed with half its contents.
CREATE FUNCTION tideway_private.purge_expired_room_scans(batch_limit integer)
RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE policy scan_retention_policy%ROWTYPE; removed integer;
BEGIN
  IF batch_limit IS NULL OR batch_limit NOT BETWEEN 1 AND 5000 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-purge-batch-limit';
  END IF;
  SELECT * INTO policy FROM scan_retention_policy WHERE id;
  IF NOT FOUND THEN RETURN 0; END IF;

  WITH due AS (
    SELECT session.id FROM room_scan_sessions session
    JOIN cleaning_requests request ON request.id = session.cleaning_request_id
    WHERE session.created_at < now() - make_interval(days =>
      CASE
        -- A request that never reached a Cleaner keeps its scan for the shorter
        -- period. 'cancelled' is included deliberately: a withdrawn request is
        -- the clearest signal a customer does not want this kept.
        WHEN request.status IN ('draft','searching-for-cleaner','cancelled') THEN policy.abandoned_days
        ELSE policy.completed_days
      END)
    ORDER BY session.created_at
    LIMIT batch_limit
    FOR UPDATE OF session SKIP LOCKED
  ), deleted AS (
    DELETE FROM room_scan_sessions WHERE id IN (SELECT id FROM due) RETURNING 1
  )
  SELECT count(*)::integer INTO removed FROM deleted;
  RETURN removed;
END;
$$;

/* ── Spoken instructions ────────────────────────────────────────────────── */

-- Phase 4 classified every spoken instruction as a request, a restriction, a
-- safety warning or a preference, and then nothing kept it. The classification
-- travelled with the walkthrough response and was gone by the time a Cleaner
-- needed it, which is why the do-not-touch panel had to be populated by whoever
-- happened to be holding the data.
--
-- Stored against the request so it survives to the checklist, and separately
-- from the tasks so a restriction can never be rendered as one by accident.
CREATE TABLE cleaning_request_voice_instructions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cleaning_request_id uuid NOT NULL REFERENCES cleaning_requests(id) ON DELETE CASCADE,
  room_name text NOT NULL DEFAULT '' CHECK (char_length(room_name) <= 120),
  instruction text NOT NULL CHECK (char_length(instruction) BETWEEN 1 AND 300),
  kind text NOT NULL CHECK (kind IN ('request','restriction','safety','preference')),
  subject text NOT NULL DEFAULT '' CHECK (char_length(subject) <= 80),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high')),
  -- Retained because the customer said it, not because a model classified it.
  -- If the classification is later found to be wrong, the words survive.
  excluded boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN 0 AND 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX cleaning_request_voice_instructions_request_idx
  ON cleaning_request_voice_instructions(cleaning_request_id, sort_order, id);

ALTER TABLE cleaning_request_voice_instructions ENABLE ROW LEVEL SECURITY;
CREATE POLICY request_voice_instructions_owner_or_admin ON cleaning_request_voice_instructions USING (
  EXISTS (SELECT 1 FROM cleaning_requests request WHERE request.id = cleaning_request_voice_instructions.cleaning_request_id
    AND (request.landlord_user_id = tideway_private.current_user_id() OR tideway_private.has_role('administrator')))
);

-- Replaces the set wholesale, for the same reason measurements are replaced
-- wholesale: a half-updated set of instructions is two versions of what the
-- customer said, and nothing reading them could tell which was current.
CREATE FUNCTION tideway_private.record_request_voice_instructions(
  target_request_id uuid, supplied_instructions jsonb
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  actor_id uuid := tideway_private.current_user_id();
  request_status text;
  entry jsonb;
  position integer := 0;
  stored jsonb;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('landlord') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='landlord-required';
  END IF;
  IF jsonb_typeof(supplied_instructions) <> 'array' OR jsonb_array_length(supplied_instructions) > 60 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-voice-instructions';
  END IF;

  SELECT request.status INTO request_status FROM cleaning_requests request
    WHERE request.id = target_request_id AND request.landlord_user_id = actor_id;
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='request-not-found'; END IF;
  IF request_status <> 'draft' THEN RAISE EXCEPTION USING ERRCODE='P0001', MESSAGE='request-not-editable'; END IF;

  DELETE FROM cleaning_request_voice_instructions WHERE cleaning_request_id = target_request_id;

  FOR entry IN SELECT value FROM jsonb_array_elements(supplied_instructions) LOOP
    IF jsonb_typeof(entry) <> 'object'
      OR char_length(COALESCE(entry->>'instruction','')) NOT BETWEEN 1 AND 300
      OR COALESCE(entry->>'kind','') NOT IN ('request','restriction','safety','preference')
      OR char_length(COALESCE(entry->>'roomName','')) > 120
      OR char_length(COALESCE(entry->>'subject','')) > 80
    THEN RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-voice-instruction'; END IF;

    INSERT INTO cleaning_request_voice_instructions (
      cleaning_request_id, room_name, instruction, kind, subject, priority, excluded, sort_order)
    VALUES (
      target_request_id,
      COALESCE(entry->>'roomName',''), entry->>'instruction', entry->>'kind',
      COALESCE(entry->>'subject',''),
      CASE WHEN entry->>'priority' = 'high' THEN 'high' ELSE 'normal' END,
      COALESCE((entry->>'excluded') = 'true', false),
      position);
    position := position + 1;
  END LOOP;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'roomName', instruction.room_name, 'instruction', instruction.instruction, 'kind', instruction.kind,
    'subject', instruction.subject, 'priority', instruction.priority, 'excluded', instruction.excluded)
    ORDER BY instruction.sort_order, instruction.id), '[]'::jsonb)
    INTO stored FROM cleaning_request_voice_instructions instruction
    WHERE instruction.cleaning_request_id = target_request_id;
  RETURN stored;
END;
$$;

-- Private customer review data. The operational Cleaner handoff remains outside
-- this scanner change so the separate Cleaner workspace and permissions cannot
-- be widened by a scanner release.
CREATE FUNCTION tideway_private.get_request_voice_instructions(target_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id(); request_record cleaning_requests%ROWTYPE; stored jsonb;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication-required'; END IF;
  SELECT * INTO request_record FROM cleaning_requests request WHERE request.id = target_request_id;
  IF NOT FOUND OR NOT (
    request_record.landlord_user_id = actor_id
    OR tideway_private.has_role('administrator')
  ) THEN RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='request-not-found'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'roomName', instruction.room_name, 'instruction', instruction.instruction, 'kind', instruction.kind,
    'subject', instruction.subject, 'priority', instruction.priority, 'excluded', instruction.excluded)
    ORDER BY instruction.sort_order, instruction.id), '[]'::jsonb)
    INTO stored FROM cleaning_request_voice_instructions instruction
    WHERE instruction.cleaning_request_id = target_request_id;
  RETURN stored;
END;
$$;

/* ── Add-on catalogue ───────────────────────────────────────────────────── */

-- The pricing engine has always accepted add-ons and nothing defined them, so an
-- add-on could only ever come from a caller inventing one — which means a price
-- component with no reviewed amount behind it.
CREATE TABLE scan_pricing_addons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL CHECK (code ~ '^[a-z0-9-]{2,40}$'),
  label text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 80),
  price_pence integer NOT NULL CHECK (price_pence BETWEEN 1 AND 100000),
  -- Roughly how much longer the visit takes, so a chosen add-on can inform the
  -- expected duration rather than only the price.
  added_minutes integer NOT NULL DEFAULT 0 CHECK (added_minutes BETWEEN 0 AND 480),
  active boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code)
);

ALTER TABLE scan_pricing_addons ENABLE ROW LEVEL SECURITY;
-- Readable by any authenticated account, like the rates: a customer choosing an
-- add-on is entitled to see what it costs.
CREATE POLICY scan_pricing_addons_readable ON scan_pricing_addons FOR SELECT USING (
  tideway_private.current_user_id() IS NOT NULL
);

CREATE FUNCTION tideway_private.list_scan_pricing_addons()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE stored jsonb;
BEGIN
  IF tideway_private.current_user_id() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication-required';
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code', addon.code, 'label', addon.label, 'pence', addon.price_pence, 'addedMinutes', addon.added_minutes)
    ORDER BY addon.label), '[]'::jsonb)
    INTO stored FROM scan_pricing_addons addon WHERE addon.active;
  RETURN stored;
END;
$$;

CREATE FUNCTION tideway_private.upsert_scan_pricing_addon(
  supplied_code text, supplied_label text, supplied_pence integer, supplied_minutes integer, supplied_active boolean
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id(); stored_id uuid;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  BEGIN
    INSERT INTO scan_pricing_addons (code, label, price_pence, added_minutes, active, updated_by)
      VALUES (lower(trim(COALESCE(supplied_code,''))), trim(COALESCE(supplied_label,'')),
        supplied_pence, COALESCE(supplied_minutes, 0), COALESCE(supplied_active, true), actor_id)
    ON CONFLICT (code) DO UPDATE SET
      label = excluded.label, price_pence = excluded.price_pence, added_minutes = excluded.added_minutes,
      active = excluded.active, updated_by = actor_id, updated_at = now()
      RETURNING id INTO stored_id;
  EXCEPTION WHEN check_violation OR not_null_violation OR invalid_text_representation THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-pricing-addon';
  END;
  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (actor_id, 'scan-pricing-addon-updated', 'scan_pricing_addon', stored_id,
      jsonb_build_object('code', lower(trim(COALESCE(supplied_code,''))), 'pence', supplied_pence));
  RETURN tideway_private.list_scan_pricing_addons();
END;
$$;

CREATE FUNCTION tideway_private.set_scan_retention_policy(
  supplied_abandoned_days integer, supplied_completed_days integer
) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id(); policy scan_retention_policy%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  BEGIN
    UPDATE scan_retention_policy
      SET abandoned_days = supplied_abandoned_days, completed_days = supplied_completed_days,
        updated_by = actor_id, updated_at = now()
      WHERE id RETURNING * INTO policy;
  EXCEPTION WHEN check_violation OR not_null_violation THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid-retention-policy';
  END;
  -- The policy row has a boolean primary key, so there is no uuid to point at.
  -- Recorded against the acting Administrator, who is the subject the entry is
  -- actually about: audit_logs requires a resource, and inventing one would be
  -- less truthful than naming the person who made the change.
  INSERT INTO audit_logs (actor_user_id, action, resource_type, resource_id, metadata)
    VALUES (actor_id, 'scan-retention-policy-updated', 'scan_retention_policy', actor_id,
      jsonb_build_object('abandonedDays', policy.abandoned_days, 'completedDays', policy.completed_days));
  RETURN jsonb_build_object('abandonedDays', policy.abandoned_days, 'completedDays', policy.completed_days);
END;
$$;

-- The current policy, so the operations page can show what is actually in force
-- rather than repeating the defaults back at whoever is reading it.
CREATE FUNCTION tideway_private.get_scan_retention_policy()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE policy scan_retention_policy%ROWTYPE;
BEGIN
  IF tideway_private.current_user_id() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='authentication-required';
  END IF;
  SELECT * INTO policy FROM scan_retention_policy WHERE id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('abandonedDays', policy.abandoned_days, 'completedDays', policy.completed_days);
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.get_scan_retention_policy() FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.purge_expired_room_scans(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.record_request_voice_instructions(uuid,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.get_request_voice_instructions(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.list_scan_pricing_addons() FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.upsert_scan_pricing_addon(text,text,integer,integer,boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION tideway_private.set_scan_retention_policy(integer,integer) FROM PUBLIC;

COMMIT;
