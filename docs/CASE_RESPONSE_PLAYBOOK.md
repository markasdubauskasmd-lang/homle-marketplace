# Booking-case response playbook

This playbook supports Tideway's `tideway-case-response-v1` review safeguard. It is an evidence and privacy control, not a refund policy, insurance statement, emergency service, customer promise or authority to contact anyone outside Tideway.

## Universal review sequence

1. Confirm the signed-in account has the Administrator role and take ownership by selecting **Start review**.
2. Read the participant report as an allegation, not an established fact.
3. Use the category guidance to identify only the evidence needed for the recorded booking outcome.
4. Keep card, bank, provider-secret, exact-address, access-code, private contact and unrelated identity data out of the case note.
5. Record which evidence sources were reviewed, what those sources establish, what remains uncertain and why the booking should remain `completed` or become `cancelled`.
6. Confirm all four decision safeguards. The server rejects a resolution without the current policy version and the evidence, minimisation and no-external-action assurances.
7. If the case is under review and payment evidence is relevant, use **Review related test payment** to open the exact provider-neutral record. This read does not resolve the case or move money; return to the case before recording the outcome.
8. Treat any refund, re-clean, compensation, payment capture/cancellation/transfer, account action, insurance referral, emergency escalation or participant contact as a separate workflow requiring approved authority and policy. A test-payment button still requires its own deliberate confirmation and does not create remedy authority.

## Category routing

| Category | First review focus | Do not do from the case screen |
| --- | --- | --- |
| Safety | Immediate danger separately from the booking outcome; event times, relevant issue evidence and participant statements | Do not claim emergency response, reveal live location or treat an allegation as verified fact |
| Damage | Condition evidence, issue time, accepted scope and participant messages | Do not admit liability or promise compensation |
| Access | Accepted access pack, message times, journey and arrival evidence | Do not repeat door codes, key locations, alarms or exact addresses |
| Conduct | Participant statements, messages and the job timeline | Do not publish allegations or make legal, hiring or suspension decisions |
| Quality | Accepted checklist, task updates, Cleaner notes and relevant photos | Do not promise a re-clean, discount or refund |
| Payment | Accepted customer total, provider-neutral authorization state and payment audit references | Do not enter financial credentials or claim a capture, cancellation, refund or transfer occurred |
| Other | Reclassify mentally to the closest category and minimize the record | Do not broaden the record with unrelated personal data or promises |

## Minimum resolution-note structure

Use plain factual language:

- **Sources reviewed:** list only the relevant Tideway records.
- **Established facts:** state what the records show, with timestamps where useful.
- **Uncertain or conflicting points:** distinguish participant statements from system evidence.
- **Booking outcome:** explain why the booking is recorded as `completed` or `cancelled`.
- **Separate follow-up required:** name the kind of approval still needed without claiming it has happened.

Never paste credentials, full payment identifiers, access instructions, private contact details, medical details or unrelated personal information into the note.

## Still required before real intake

The founder must approve and evidence:

- the named person or rota that owns safety and standard cases;
- response targets for safety, priority and standard categories;
- the emergency/escalation process and jurisdiction-specific contact boundary;
- evidence retention and deletion periods;
- refund, re-clean, compensation and payment-adjustment authority;
- complaint and appeal handling;
- approved participant communication templates;
- a trained, provisioned Administrator and a two-account HTTPS rehearsal.

Until those decisions exist, the case desk can preserve and classify reports safely, start a review and record a booking outcome, but it must not claim that the wider remedy or escalation process is operational.
