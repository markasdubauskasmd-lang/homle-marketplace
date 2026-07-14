# Tideway marketplace

Independent pilot website for matching landlords and businesses with cleaning professionals. It does not use Polsia or Polsia credits.

## Run locally

Use Node.js 20 or newer:

```text
npm start
```

Then open `http://127.0.0.1:4173`.

## What works

- Customer cleaning request form with server-side validation
- Cleaner application form with server-side validation
- Local private submission files in `data/`
- Private local control desk at `/admin` with lead filters, status tracking, internal notes and next-action dates
- Internal quote calculator for checking cleaner pay and job contribution before sending a price
- Local launch-readiness form for legal identity, pilot coverage, rates, cleaner pay, insurance, live payment handling, refunds and operating rules
- Human-reviewed matching suggestions using approved cleaners, requested service type and postcode coverage
- Internal draft proposals that link a request to an approved cleaner and reject loss-making job economics
- Proposal status gates that prevent a draft becoming ready, sent or accepted until all seven launch checks pass
- Review-only customer quote and cleaner opportunity drafts with explicit warnings and no send capability
- Structured site scope, access and hazard collection plus a read-only accepted-proposal booking audit
- Private data backup script and documented recovery procedure
- Responsive, accessible website
- Draft privacy notice and pilot terms
- No payment collection and no fabricated reviews, cleaner profiles or business claims

## Before public launch

1. Add the legal operator name, trading address and verified contact details.
2. Decide the cleaner engagement model with UK employment/tax advice.
3. Confirm public liability and any other required insurance.
4. Approve pricing, cleaner pay, cancellation, complaint and re-clean rules.
5. Replace local file storage with an encrypted production database and access controls.
6. Add transactional email/SMS only after the sending account is approved.
7. Complete a real pilot in one small service area before making broader coverage claims.

If the server is ever bound to a public interface, set a strong `ADMIN_KEY`. Local control-desk access is automatic only when the server, request hostname and network connection are all verified as loopback and no proxy headers are present.
