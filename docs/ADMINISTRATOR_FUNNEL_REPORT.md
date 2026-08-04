# Administrator marketplace funnel

## Problem solved

Homle could inspect individual operational records but could not answer the safer,
more useful business question: where does the marketplace lose Landlords between
account setup, property setup, room scanning, request submission, booking, payment,
completion and review?

`/admin/funnel` answers that with aggregate counts only. It is intended to direct
product work, not identify or profile an individual.

## Cohort rules

The report supports 7, 30 and 90 day windows. Every cohort ends 24 hours before the
report is generated, so someone still completing a fresh task is not immediately
labelled as abandonment.

The three lanes are intentionally independent:

- Landlord setup is cohort-based on a verified Landlord role grant.
- Request journey is cohort-based on a cleaning request being created.
- Payment is cohort-based on a booking being created.

Stage counts are cumulative inside a lane. For example, a booking is included in the
request lane only when that request also has a stored structured scan and was
submitted. This keeps percentages honest even when historical records predate the
current guided journey.

## Privacy and authorization

- Both the HTTP route and database function require the Administrator role.
- The application runtime has execute permission on the protected database function,
  not direct read permission on structured scans or payment records.
- The result contains counts and timestamps only.
- It excludes names, emails, avatars, account IDs, property/request/booking IDs,
  addresses, postcodes, coordinates, room data, photos, provider identifiers, prices
  and payment amounts.
- No browser analytics ID, tracking cookie or new event table is introduced.

## Operational limitations

- Counts update from current authoritative state, so a matured cohort can progress
  between snapshots.
- A 24-hour delay reduces false abandonment but is not a causal attribution model.
- Very small cohorts should not drive marketing or product decisions by themselves.
- Refunded counts are shown as context and are not another conversion stage.

## Verification

Unit/UI tests validate strict output shape, descending stage counts, safe DOM
rendering, mobile layout and role gating. The disposable PostgreSQL rehearsal proves
Landlord/Cleaner denial, Administrator access, 24-hour cohort maturity, cumulative
stage derivation, private-field exclusion and absence of direct runtime access to scan
or payment tables.
