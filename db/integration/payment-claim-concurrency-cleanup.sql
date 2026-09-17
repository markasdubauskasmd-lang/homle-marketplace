-- Standalone raw SQL equivalent of the payment cleanup in the shared fixture cleanup.
BEGIN;
DELETE FROM tideway_private.payment_command_recovery_attempts WHERE command_id='54000000-0000-4000-8000-000000000002';
DELETE FROM tideway_private.payment_command_attempt_windows WHERE command_id='54000000-0000-4000-8000-000000000002';
DELETE FROM payment_commands WHERE id='54000000-0000-4000-8000-000000000002';
DELETE FROM payment_status_history WHERE payment_id='54000000-0000-4000-8000-000000000001';
DELETE FROM booking_payments WHERE id='54000000-0000-4000-8000-000000000001';
COMMIT;
