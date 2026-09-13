BEGIN;

-- Name the constraint to avoid collisions with the RETURNS TABLE variables.
CREATE OR REPLACE FUNCTION tideway_private.save_my_cleaner_onboarding_section(supplied_section text,supplied_ciphertext bytea,supplied_status text,supplied_schema_version smallint)
RETURNS TABLE(cleaner_user_id uuid,section_code text,payload_ciphertext bytea,status text,schema_version smallint,completed_at timestamptz,updated_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor_id uuid := tideway_private.current_user_id(); saved cleaner_onboarding_sections%ROWTYPE;
BEGIN
  IF actor_id IS NULL OR NOT tideway_private.has_role('cleaner') THEN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='cleaner-role-required'; END IF;
  IF supplied_status NOT IN ('draft','submitted') THEN RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid-onboarding-status'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('onboarding:' || actor_id::text,0));
  INSERT INTO cleaner_onboarding_sections(cleaner_user_id,section_code,payload_ciphertext,status,schema_version,completed_at)
    VALUES(actor_id,supplied_section,supplied_ciphertext,supplied_status,supplied_schema_version,CASE WHEN supplied_status='submitted' THEN now() ELSE NULL END)
    ON CONFLICT ON CONSTRAINT cleaner_onboarding_sections_pkey DO UPDATE SET payload_ciphertext=EXCLUDED.payload_ciphertext,status=EXCLUDED.status,schema_version=EXCLUDED.schema_version,completed_at=EXCLUDED.completed_at,updated_at=now()
    RETURNING * INTO saved;
  -- A changed section must be reviewed again; a previous submission cannot
  -- remain valid after the applicant replaces its contents.
  IF supplied_section <> 'review' THEN
    UPDATE cleaner_onboarding_sections s SET status='draft',completed_at=NULL,updated_at=now()
      WHERE s.cleaner_user_id=actor_id AND s.section_code='review' AND s.status IN ('submitted','verified');
  END IF;
  INSERT INTO audit_logs(actor_user_id,action,resource_type,resource_id,metadata)
    VALUES(actor_id,'cleaner-onboarding-section-saved','cleaner_onboarding',supplied_section,jsonb_build_object('status',supplied_status,'schemaVersion',supplied_schema_version));
  RETURN QUERY SELECT saved.cleaner_user_id,saved.section_code,saved.payload_ciphertext,saved.status,saved.schema_version,saved.completed_at,saved.updated_at;
END $$;

COMMIT;
