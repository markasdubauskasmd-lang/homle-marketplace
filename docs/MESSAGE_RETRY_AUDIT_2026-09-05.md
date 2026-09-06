# Landlord message retry audit — 5 September 2026

## Current state and scope

The preceding goal turn made progress: it implemented and fully tested the Updates
recovery fix in PR #421. Deployment remained blocked by the concurrent Cleaner
design upload `01b9948`. This continuation revalidated that exact main commit and
the completed failed GitHub gate. The upload is untouched pending the user's answer.

Independent inspection found a message-delivery defect in the Landlord composer.
The service and database already deduplicate sends by sender and client message ID,
checking that a retry has the same booking and body. The browser nevertheless
created a fresh client ID on every click, so retrying after a lost response defeated
the existing guarantee and could create a second message and notification.

## Repair

Keep the pending body and client ID in memory per booking. Unchanged text reuses the
pending ID after failure. Changed text receives a new ID, and a confirmed send clears
the pending record so an intentional later repeat remains possible. The send button
exposes the existing sending lock, and the composer clears only if its text still
matches what was sent; typing the next message during a slow send now survives.

Retry feedback describes unconfirmed delivery without claiming the server never
received the message. Nothing is stored in persistent browser storage. Pending retry
protection lasts for the loaded page; a reload is outside that in-memory lifecycle.

Only the Landlord Messages client changes, plus the dashboard's asset versions and
test pins. Shared message helpers, APIs, database code, notification generation and
Cleaner files remain unchanged.

## Verification

A Chromium test mounts the actual Messages panel and real module against an isolated
request adapter modelling server deduplication and response loss. It failed before
the fix because the retry created two saved messages. At 390px and 1280px it now proves:

- lost-response retry reuses one ID and reconciles one saved/displayed message;
- failed delivery preserves composer text;
- repeated submissions during an in-flight send produce one request;
- typing during a send is preserved when that send acknowledges;
- an intentional subsequent identical message receives a new ID;
- the sending lock clears and no browser exception occurs.

Message service, Messages concurrency, booking dashboard and the 762-element computed
style baseline also pass. Cleaner freeze verifies 89 protected files and 9 shared
outcome modules unchanged. No real booking participant was contacted.

## Release and remaining work

The public-brand gate fails independently on `public/homlle-onboarding.html` from
main, for the same missing approved icon reported in PR #421. The new upload has not
been changed, excluded from tests or deployed. This fix is prepared for review while
that release decision remains pending. Full hosted journey evidence, email and
provider-backed payment rehearsal remain unfinished parts of the standing objective.
