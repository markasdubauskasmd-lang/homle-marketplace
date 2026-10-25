-- Read one booking case by its own id, without changing it.
--
-- This exists to fix an ordering defect in the case desk's refund, found by
-- review. The desk resolved the case first and refunded second, on the stated
-- reasoning that nothing about resolving closes the door on a later refund.
-- That reasoning was wrong for one outcome, and it is the common one.
--
-- Resolving with the outcome `completed` moves the booking from `disputed` to
-- `completed` (migration 033). `can_transfer` in migration 113 then becomes
-- true, and the settlement loop -- which runs every five minutes -- pays the
-- Cleaner. Once a transfer command exists and has not failed at the provider,
-- migration 113 refuses every subsequent refund on that payment, permanently.
-- So a refund that failed at the moment of resolution could not be retried
-- afterwards either, while the screen was telling the Administrator to send it
-- from the payments desk. The window was about five minutes wide and closed
-- silently.
--
-- The fix is to refund BEFORE resolving, which needs the case's own booking id
-- before anything has been written. There was no way to read a case by id:
-- `get_booking_dispute` takes a booking id, and the administrator queue is a
-- paginated list. Hence this.
--
-- It is `STABLE` and takes no lock, because it genuinely only reads. The
-- decision it informs is re-made under `FOR UPDATE` inside
-- `review_booking_dispute`, which is where it has to be.

BEGIN;

CREATE FUNCTION tideway_private.get_booking_dispute_for_administrator(target_dispute_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE dispute_record disputes%ROWTYPE;
BEGIN
  IF tideway_private.current_user_id() IS NULL OR NOT tideway_private.has_role('administrator') THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='administrator-required';
  END IF;
  SELECT * INTO dispute_record FROM disputes dispute WHERE dispute.id = target_dispute_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='P0002', MESSAGE='dispute-not-found';
  END IF;
  -- The same projection the rest of the case desk uses. A second shape of
  -- "what a case is" is how a screen and a decision drift apart.
  RETURN tideway_private.dispute_result(dispute_record);
END;
$$;

REVOKE ALL ON FUNCTION tideway_private.get_booking_dispute_for_administrator(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tideway_private.get_booking_dispute_for_administrator(uuid) TO tideway_app;

COMMIT;
