\set ON_ERROR_STOP on

BEGIN;

DO $facebook_deletion$
DECLARE
  known_first jsonb;
  known_retry jsonb;
  known_status jsonb;
  unknown_first jsonb;
  unknown_status jsonb;
  collision_rejected boolean := false;
BEGIN
  BEGIN
    PERFORM 1 FROM tideway_private.facebook_data_deletion_requests;
    RAISE EXCEPTION 'Runtime role can read private Facebook deletion confirmation material';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT tideway_private.request_facebook_data_deletion(
    '73000000-0000-4000-8000-000000000001',
    '1234567890123456',
    decode(repeat('e1', 32), 'hex'),
    decode(repeat('e2', 32), 'hex')
  ) INTO known_first;
  SELECT tideway_private.request_facebook_data_deletion(
    '73000000-0000-4000-8000-000000000002',
    '1234567890123456',
    decode(repeat('e1', 32), 'hex'),
    decode(repeat('e2', 32), 'hex')
  ) INTO known_retry;
  SELECT tideway_private.get_facebook_data_deletion_status(decode(repeat('e2', 32), 'hex')) INTO known_status;
  IF known_first->>'status' <> 'requested'
     OR known_retry->>'status' <> 'requested'
     OR known_status->>'status' <> 'requested'
     OR known_first->>'requestedAt' IS DISTINCT FROM known_retry->>'requestedAt'
     OR known_first->>'requestedAt' IS DISTINCT FROM known_status->>'requestedAt'
  THEN
    RAISE EXCEPTION 'Known Facebook subject did not enter one stable deletion queue item';
  END IF;

  SELECT tideway_private.request_facebook_data_deletion(
    '73000000-0000-4000-8000-000000000003',
    '9988776655443322',
    decode(repeat('e3', 32), 'hex'),
    decode(repeat('e4', 32), 'hex')
  ) INTO unknown_first;
  SELECT tideway_private.get_facebook_data_deletion_status(decode(repeat('e4', 32), 'hex')) INTO unknown_status;
  IF unknown_first->>'status' <> 'completed'
     OR unknown_status->>'status' <> 'completed'
     OR unknown_status->>'completedAt' IS NULL
  THEN
    RAISE EXCEPTION 'Unknown Facebook subject did not receive an honest completed confirmation';
  END IF;

  IF tideway_private.get_facebook_data_deletion_status(decode(repeat('ef', 32), 'hex')) IS NOT NULL THEN
    RAISE EXCEPTION 'Unknown confirmation hash exposed a Facebook deletion status';
  END IF;

  BEGIN
    PERFORM tideway_private.request_facebook_data_deletion(
      '73000000-0000-4000-8000-000000000001',
      '1111222233334444',
      decode(repeat('e5', 32), 'hex'),
      decode(repeat('e6', 32), 'hex')
    );
  EXCEPTION WHEN unique_violation THEN
    collision_rejected := SQLERRM = 'facebook-deletion-request-id-reused';
  END;
  IF collision_rejected IS NOT TRUE THEN
    RAISE EXCEPTION 'Facebook deletion request identifier reuse did not fail closed';
  END IF;
END
$facebook_deletion$;

COMMIT;
