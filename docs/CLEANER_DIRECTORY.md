# Cleaner profiles and directory boundary

This is a source-code and database-migration checkpoint. The public `/cleaners` page exists, but the current local pilot has no approved account-backed Cleaner profiles. Its API-backed results therefore fail closed with an honest unavailable/empty state; Tideway must not imply that searchable Cleaner supply exists.

## Profile ownership and publication

A Cleaner account can save only its own profile: the repository obtains the target user ID from the authenticated actor and every query runs inside that actor's RLS transaction. Landlord accounts cannot enter the profile-edit service. Identity/background status, rating aggregates, completed-job counts, verified badges and acceptance rate are never accepted from the cleaner-edit input.

Completion is deterministic, with ten equally weighted sections: secure profile photo, substantive biography, service, usable pricing, travel radius, outward-postcode service area, experience, language, supplied equipment/products and residential/commercial preference. An incomplete profile may be saved privately but cannot set `is_public` until it reaches 100%.

## Public discovery

The restricted PostgreSQL directory function returns only explicitly listed public fields. It supports:

- outward postcode;
- full-window availability;
- minimum rating;
- maximum price;
- service offered;
- calculated distance and maximum distance;
- verified identity status;
- bounded pagination.

Only active accounts with a public 100%-complete profile can appear. Ranking is verified status, rating, completed jobs, distance, price and stable public slug. These are discovery factors, not an assertion that the cleaner is assigned or available for a booking; acceptance and overlap checks still run transactionally later.

The browser keeps only outward postcode and service visible for the first search. Rating, price, exact availability and recorded-verification filters remain available under one **More filters** disclosure. Every result keeps profile facts optional but exposes one truthful **Start a cleaning request** action directly on the card. That action enters `/signup?intent=book`; it does not use the legacy `/request` form or claim that the displayed Cleaner has been selected. Tideway still rechecks the submitted room scan, date, price, travel coverage, availability and acceptance before confirmation.

Cleaner service-area latitude/longitude is no longer directly readable under public RLS. The restricted directory function may use it to calculate a rounded distance, but coordinates are not returned. Public projection code also discards any injected email, phone, home address, coordinate or internal acceptance-rate field.

## Remaining staging evidence

Before enabling `/cleaners`, apply migrations to staging PostgreSQL and prove RLS with separate Cleaner, Landlord and unrelated accounts. Add real geocoding under an approved privacy/cost decision, database query-plan/index tests with representative volume, authenticated edit/search HTTP routes, accessible mobile UI, and real cleaner records created through completed onboarding. Do not seed invented public cleaners, ratings, checks or availability.
