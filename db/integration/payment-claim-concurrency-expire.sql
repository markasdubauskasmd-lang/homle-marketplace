\set ON_ERROR_STOP on
-- Fixed timestamps make the second verification prove that neither retry reset it.
UPDATE tideway_private.payment_command_attempt_windows SET first_attempt_at='2020-01-01T00:00:00Z',retry_before='2020-01-01T23:00:00Z'
WHERE command_id='54000000-0000-4000-8000-000000000002';
