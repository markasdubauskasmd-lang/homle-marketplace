# Landlord support history audit — 5 September 2026

The preceding goal turn made progress by deploying checkout session serialization
in PR #419. This continuation inspected current main (`43ee0d6`) and traced the
Landlord support page through its UI model, service and database list contract.

## Finding and benefit

Help always fetched `limit=25&offset=0`. The authenticated support API already
accepts offsets, but no browser control exposed older pages. An answered request
could therefore disappear from the only place a Landlord is told to read the reply.
Expose existing history before adding another support channel or notification.

## Implementation boundary

The Landlord Help controller and HTML gain a Load older requests button, read status
and local history error message. Existing cards remain on failure; form fields are
untouched by reads. Duplicate IDs at an offset boundary appear once. A refresh
returns to the newest page. Concurrent clicks share one pending read, and a successful
submission waits for any preceding read before refreshing the newly created request.
Read requests time out after 20 seconds and restore controls for retry.

No backend, schema, permissions, shared styling, support submission semantics,
Administrator queue or Cleaner behavior changes. The existing API's maximum offset
is respected and explicitly described if reached. Like the underlying offset API,
this is not a snapshot across tabs; Refresh is the route to the latest first page.

## Verification

The real Help page was exercised in isolated Chromium at 390px and 1280px with
26 synthetic support records. The test checks:

- initial 25 records and access to the older answer;
- failed older-page read, visible error and cleared busy state;
- draft subject and description preserved across reads and refresh;
- one read for repeated clicks, no duplicate cards at a shifted page boundary;
- end-of-history state and no horizontal viewport overflow;
- history navigation sends no support creation requests;
- submission during an older-page read sends once and displays the new record;
- no unhandled browser errors.

Support UI/service, booking dashboard, link integrity and Cleaner freeze checks
cover adjacent boundaries. Browser fixtures do not prove real email delivery or a
hosted Administrator response; no real support message or customer contact was sent.

## Remaining objective

Continue complete hosted journey evidence, transactional email setup, genuine
Cleaner supply and the provider-backed test payment cycle. This repair improves
support continuity; it does not establish completion of the full marketplace goal.
