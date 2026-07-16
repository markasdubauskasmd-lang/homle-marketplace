\set ON_ERROR_STOP on

BEGIN;
INSERT INTO bookings(
  id,landlord_user_id,cleaner_user_id,property_id,status,scheduled_start_at,scheduled_end_at,
  customer_price_pence,cleaner_pay_pence,accepted_by_cleaner_at,confirmed_at,invited_at,
  cleaner_response_deadline,responded_at,scope_fingerprint,terms_fingerprint,scope_snapshot,
  planned_payment_fee_pence,planned_travel_cost_pence,planned_supplies_cost_pence,planned_other_cost_pence,target_margin_basis_points
)
VALUES(
  '40000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','confirmed',now()+interval '72 hours',now()+interval '74 hours',
  8000,5000,now(),now(),now(),now()+interval '24 hours',now(),repeat('d',64),repeat('e',64),jsonb_build_object('fixture','dispute'),
  300,200,100,100,1000
);
COMMIT;
