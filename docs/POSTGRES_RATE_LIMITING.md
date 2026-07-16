# PostgreSQL shared rate limiting

## Purpose

Tideway must make the same abuse-control decision when requests reach different application instances. Migration `020_shared_rate_limits.sql` provides one atomic PostgreSQL bucket per reviewed scope and private client-key hash. The main marketplace attachment creates this limiter internally after its database probe confirms the function exists; the deployment adapter no longer has to invent its own limiter.

This is prepared source, not production evidence. `MARKETPLACE_ENABLED` remains false until migration 020 and the full database suite pass against PostgreSQL 16, and the same threshold is demonstrated through at least two application instances behind the final HTTPS proxy.

## Privacy boundary

- The deployment adapter derives a trusted client identifier from the actual socket and explicitly configured proxy hops. Browser-supplied forwarding headers must never be trusted directly.
- `createPostgresRateLimiter` HMACs that identifier with a purpose string, the `SESSION_SECRET` and the exact route scope. PostgreSQL receives only a 32-byte digest.
- The same client produces different hashes in different scopes, preventing database-level correlation between login, signup and directory activity.
- Neither `tideway_app` nor `tideway_worker` can read, insert, update or delete the private counter table directly.
- Only `tideway_app` may execute the fixed policy function. Only `tideway_worker` may execute the bounded retention function.
- Buckets inactive for two hours are eligible for deletion, safely beyond the longest one-hour window. No request path or audit event stores a raw IP address.

## Reviewed policies

| Scope | Requests | Window |
| --- | ---: | ---: |
| Google start | 20 | 15 minutes |
| Google callback | 30 | 15 minutes |
| Signup | 5 | 60 minutes |
| Verification resend | 5 | 60 minutes |
| Verification confirmation | 20 | 60 minutes |
| Login | 10 | 15 minutes |
| Password-reset request | 5 | 60 minutes |
| Password-reset confirmation | 10 | 60 minutes |
| Cleaner directory | 60 | 1 minute |
| Cleaner reviews | 120 | 1 minute |

The SQL function owns these values; a caller cannot supply a larger limit or window. The table caps each count at the selected threshold plus one, avoiding integer growth during sustained abuse. A denied request receives a bounded `Retry-After`. Unknown scopes, malformed keys, missing rows, bad database decisions and database outages fail closed.

Account credential locking remains a separate defense. The shared client-key bucket limits one source; persistent failed-password tracking limits attempts against one account even when sources change.

## Deployment evidence required

1. Apply all 20 locked migrations and both current role-grant files.
2. Run `tools/postgres-verification-runner.mjs`; it checks the function, purge grant, private table/index and absence of direct restricted-role access.
3. Run `tools/postgres-integration-runner.mjs`; its app-role behavior transaction proves ten allowed login decisions, the eleventh denial and direct-table denial, then rolls the fixture back.
4. Route controlled staging requests through two application instances with the same `SESSION_SECRET` and trusted client resolver. Confirm their combined request count reaches one shared threshold.
5. Schedule `SELECT tideway_private.purge_expired_rate_limits(1000);` through `tideway_worker` at least hourly. Alert on failure and drain another bounded batch whenever 1000 rows are returned.
6. Monitor only aggregate scope/allow/deny/latency metrics. Do not log the raw trusted key, HMAC digest, authentication body or provider callback parameters.

Changing a scope, threshold, window or retention period requires a reviewed migration, matching adapter/test updates, a database-lock checksum update and another real two-instance test.
