# Request-specific Cleaner matching

This Phase 3 checkpoint recommends real eligible Cleaners for one authenticated Landlord request. It is an explainable shortlist for invitation, not an automatic assignment and not a claim that Cleaner supply exists.

## Eligibility before ranking

`GET /api/marketplace/cleaning-requests/:cleaningRequestId/matches` is restricted to the request-owning Landlord. PostgreSQL first rejects a missing, closed, past or non-owned request. A Cleaner enters the candidate set only when all of these remain true:

- their account is active and their public profile is complete;
- their residential/commercial preference fits the property type;
- every requested service is active and has an automatic fixed/hourly price;
- one declared available window covers the complete requested visit;
- no pending or active booking overlaps the requested interval;
- the property is in a declared outward-postcode area, or its coordinates fall within the Cleaner’s travel radius from a declared service base;
- the same coordinate-backed distance is available for the frozen travel-cost calculation whenever an approved per-kilometre travel rate is non-zero;
- the private pricing policy can produce a positive target-margin customer estimate inside the request budget, when a budget was supplied.

Manual-quote, missing-price, out-of-budget and unsafe-range candidates fail closed instead of receiving an invented estimate.

## Ranking and privacy

Eligible candidates are ranked with bounded factors for declared distance/coverage, approved review aggregate, previous completed Landlord-Cleaner jobs, identity-check status, price and internal acceptance reliability. Availability and required-service fit are hard gates rather than points that could compensate for being unavailable or unqualified.

The manual invitation path now retrieves the same property-to-service-area distance as automatic matching before freezing its quote. Missing, malformed, negative or implausible distance evidence cannot silently become a zero-cost trip when distance pricing is active.

The response contains only the public Cleaner profile fields, rounded distance, prior relationship count, server-derived customer estimate, rank and plain-language reasons. It does not return email, phone, home address, service-area coordinates, Cleaner pay, platform costs, raw acceptance rate or the internal numeric factor breakdown. The estimate is not frozen until the invitation transaction rechecks everything and commits the scope and terms fingerprints.

## Operational boundary

Matching and invitations remain unavailable until all private `BOOKING_*` assumptions are explicitly configured. Migration `010_request_cleaner_matching.sql` must be executed after migration 009 against staging PostgreSQL, including owner-denial, empty-supply, postcode-only, coordinate-radius, withdrawn availability, overlapping job and budget regressions.

No Cleaner is contacted or assigned automatically. No live pilot data was created or modified by this checkpoint.
