# Durable scanner reliability evidence — 21 August 2026

## Opportunity

Homle's room scanner is the product's main differentiator, but its privacy-safe
operational counters previously lived only in one Node process. Every Render
restart or deployment erased completion, failure, correction and latency
evidence. That made release-to-release mobile reliability impossible to judge.

## Change

- Scanner events remain synchronous, local and non-blocking on the customer path.
- A background adapter batches only the existing fixed event vocabulary into
  hourly database aggregates.
- The database rejects unknown keys, metrics, dimensions and timing buckets.
  It has no identities, sessions, properties, requests, rooms, objects, notes,
  transcripts or media.
- Detailed aggregates expire after 90 days; the Administrator view reports a
  rolling 30-day window across deployments.
- A database outage never interrupts scanning. Failed writes remain bounded and
  failed reads visibly fall back to the current process.

## Business benefit

Homle can now compare completion, camera permission success, crash-free use,
reading latency and estimate reliability between scanner releases. That targets
the highest-friction step before a booking with evidence instead of anecdotes.

## Verification

- Collector tests prove arbitrary image, room and note fields are stripped.
- Durable-adapter tests prove asynchronous batching and honest outage fallback.
- Repository tests prove identity-free writes and Administrator-bound reads.
- Database assets prove strict allowlists, RLS and a 90-day retention boundary.
- The Cleaner Dashboard remains outside the change set and its freeze suite is
  required before release.
