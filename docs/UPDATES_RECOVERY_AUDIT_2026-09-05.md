# Updates session recovery — 5 September 2026

The previous goal turn made progress by deploying support history in PR #420.
This continuation fetched main (`a6d20c4`) and traced the generic Updates page,
its session-token handling, list/read-all calls and dedicated Cleaner redirect.

## Finding

Opening Updates in a new tab retains the authenticated cookie but starts without a
sessionStorage editing token. Mark all read checked only that local token and told
the signed-in user to sign in again. It never requested the available session token.
The page also reported success after refreshing even when its load function caught
an error, potentially hiding a failed read behind a false success message.

## Change and boundary

The generic Updates controller now recovers a missing session token through the
existing authenticated endpoint. It locks the action before awaiting recovery,
blocks overlapping pagination and keeps the original inbox cutoff for the mutation.
New notifications received while recovery is pending stay unread. The returned
server result still governs counts and card states.

A successful mutation followed by a failed read explains both outcomes in the
visible gate; retry only reloads the inbox. Session/list reads are bounded at 20
seconds and marking read at 30 seconds. No automatic mutation retry is added.
The HTML asset version is advanced for returning browsers.

Only generic Updates HTML/controller, its tests and this audit change. The Cleaner
redirect, dedicated Cleaner inbox, shared session implementation, notification
service, read cutoff policy, endpoints, database and event generation remain intact.

## Evidence

The actual page ran against controlled localhost endpoints in Chromium. The
regression failed on main at the fresh-tab action; after the fix it passes at
390px and 1280px and checks:

- missing-token recovery, failure feedback and deliberate retry;
- exactly one recovery and read mutation despite repeated clicks;
- the original cutoff surviving delayed recovery;
- a new arrival retaining its unread count and card state;
- a saved read outcome remaining explicit when inbox refresh fails;
- retrying that failed refresh issuing no additional mutation;
- no horizontal overflow or unhandled browser errors.

The notification model/service and booking dashboard tests cover adjacent contracts;
the Cleaner freeze proves 89 protected files and 9 shared outcome modules unchanged.
All mutations in the browser proof target synthetic local fixtures. No real user's
updates were marked read.

## Remaining objective

This repairs one notification journey. Genuine hosted account/booking rehearsal,
transactional email, discoverable Cleaner supply and provider-backed test-payment
evidence remain separate incomplete requirements of the standing objective.
