# Administrator supply and demand coverage

Homle now has an Administrator-only operational report at `/admin/coverage`.
It answers one narrow launch question: where has submitted demand failed to
find an eligible Cleaner under the same rules used by the marketplace?

## What the report measures

The report supports 7, 30 and 90-day windows. It shows:

- submitted and currently unmatched request counts;
- expired unmatched requests;
- future requests with zero or only one eligible Cleaner;
- the age of the oldest unmatched request;
- requested and zero-match service codes;
- the total number of active, complete, public Cleaner profiles.

Demand is grouped by UK outward postcode. Eligibility is recalculated for each
future unmatched request with
`tideway_private.recommend_cleaners_for_request_v3`, so service, availability,
date, distance, schedule conflicts and, when payments are attached, payout
readiness remain aligned with the real matcher.

## Privacy and authorization boundary

Only an authenticated Administrator can open the report API. The stored
function independently repeats the Administrator role check and is not
executable by `PUBLIC`.

The response intentionally contains no:

- account, request, property, Landlord or Cleaner identifiers;
- names, email addresses or phone numbers;
- exact postcodes, addresses or coordinates;
- room notes, photographs or access instructions.

The browser receives outward-postcode aggregates only. The report is linked
from the separate Administrator control desk; it changes no Cleaner page,
route, profile, matching authority or Cleaner Dashboard behavior.

## Honest limitations

- It is an operational snapshot, not a forecast or a promise of supply.
- Eligible counts are capped at 50 per request, and the UI says when a count
  reached that ceiling.
- `active listed supply` is deliberately coarse and is not assigned to an
  outward postcode. It must not be read as coverage for every displayed area.
- Unknown or malformed property postcodes are grouped under `UNKNOWN`; no
  location is invented.
- The report does not contact, recruit, rank, approve or reject Cleaners. It
  does not change requests, bookings, prices or payments.
- Demand older than the selected submitted-at window is excluded even when it
  remains operationally relevant. Administrators can switch to 90 days when
  investigating older demand.

## Verification

Source and browser tests cover output validation, role gating, safe rendering,
responsive behavior and protected HTTP routing. The guarded PostgreSQL
rehearsal proves:

- Landlords and Cleaners cannot read the report;
- the Administrator sees only aggregates;
- marketplace mode and payout-ready mode use the expected eligibility
  boundary;
- runtime roles cannot bypass the function to inspect private payout data;
- serialized output contains none of the fixture identities, exact postcodes,
  coordinates or property details.

Migration `081_administrator_coverage_report.sql` installs the function. The
locked migration order, runtime grant and deployment verifier all include it.
