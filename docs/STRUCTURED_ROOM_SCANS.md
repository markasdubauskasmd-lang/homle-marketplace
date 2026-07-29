# Structured room scans

Phase 2 of the room-scanning plan in
[the architecture audit](ROOM_SCAN_ARCHITECTURE_AUDIT.md). It closes gap G1: the
structured scan result was being discarded at submission.

## What was wrong

The scanner has always produced far more than it kept. Per room it builds an
object inventory with stable identity keys, proven quantities, per-object
conditions, an enumerated soiling taxonomy, two independent confidence scores
and a required evidence string. When the overlay closed, the booking journey
kept this and nothing else:

```js
// public/landlord-journey.js, before this change
state.draft.tasks = Array.isArray(result.tasks) ? result.tasks : [];
```

Only the generated task strings survived. What reached PostgreSQL was
`cleaning_request_tasks` — a room name and a line of free text — plus the
sanitised photographs and a fingerprint hash. Everything else was
garbage-collected when the overlay closed.

Three consequences followed from that one line:

- **Condition could not influence price**, because it was never stored.
- **A quote could not be explained afterwards**, because its inputs were gone.
- **Customer corrections were discarded** at the moment they were made — the
  single most valuable label source in the product, thrown away.

## What is implemented

The scan is attached to the cleaning request rather than given an independent
session lifecycle. That reuses the ownership, participant-access, deletion and
submission-freeze rules the request already enforces, instead of inventing a
second set that would inevitably drift from the first.

### Storage

Migration `073_structured_room_scans.sql` adds five tables, all with row-level
security and all reachable only through reviewed `SECURITY DEFINER` functions:

| Table | Holds |
| --- | --- |
| `room_scan_sessions` | One scan per request. Device class, capture time, model attribution. |
| `room_scans` | Each room: name, whole-room condition, spoken note, order. |
| `room_scan_objects` | Each object: identity key, label, quantity, condition, soiling, both confidences, evidence, origin. |
| `room_scan_object_corrections` | Every customer correction, with the original value retained. |
| `room_scan_model_versions` | Which model and schema version produced a reading. |

### Rules the storage enforces

- **`unknown` stays absence, never a grade.** The vision reader returns
  `unknown` when a photograph cannot support a judgement, and both the room
  condition and the object condition store that as `NULL`. A room the model
  honestly declined to judge must not become a confident "Light" on the way
  into the database — the stored grade is what will later influence a price.
- **`clean` is a real answer.** Most of a well-kept home is clean, and that is
  useful information rather than a missing reading.
- **Numbers clamp, names and enums reject.** A confidence that serialises as
  `0.6200000000000001` must not discard twenty good rooms; a condition of
  "filthy" is a claim about someone's home with no safe substitute.
- **Recording is idempotent by session id.** A retried save is absorbed and
  returns the stored scan untouched. A genuinely new scan replaces the previous
  one inside the same transaction, because keeping both would double every
  object count downstream.
- **Only a draft accepts a scan.** After submission the scope is frozen and a
  Cleaner may already have accepted work against it, so neither a replacement
  scan nor a correction can change it underneath them.
- **Corrections never destroy the original.** The object row is updated so the
  customer sees their change, and the delta is appended separately. A `removed`
  correction deliberately outlives the object it describes — a rejected
  detection is the most informative label there is, and a foreign key would
  have cascaded it away.
- **Training consent is per-correction and defaults false.** No customer scan
  trains anything without an explicit choice.
- **Attribution comes from server configuration, never the request body.** A
  client able to name the model that read its own scan could write an arbitrary
  claim into the audit trail, and the audit trail exists to be trusted when a
  quote is disputed.

### Privacy boundary

The runtime role has **no direct privilege at all** on the scan tables —
`SELECT`, `INSERT`, `UPDATE` and `DELETE` are all revoked in
`db/runtime-role-grants.sql`. Every read and write goes through a function that
applies the participant rules explicitly, so no future direct query can widen
the audience by accident.

The read applies the same rule as the existing photo projection, written as the
same expression rather than a similar one: the owning Landlord and an
Administrator always; an invited Cleaner only when the Landlord authorised
preview; the assigned Cleaner from confirmation onward.

`room_scan_model_versions` stays readable, because attributing a reading to a
model discloses nothing about a customer and the projection needs it.

### API

| Method | Path | Who |
| --- | --- | --- |
| `PUT` | `/api/marketplace/cleaning-requests/:id/room-scan` | Owning Landlord, draft only |
| `GET` | `/api/marketplace/cleaning-requests/:id/room-scan` | Participant-aware |
| `DELETE` | `/api/marketplace/cleaning-requests/:id/room-scan` | Owning Landlord, draft only |
| `POST` | `/api/marketplace/cleaning-requests/:id/room-scan/objects/:objectId` | Owning Landlord, draft only |

`GET` is deliberately not Landlord-only: an assigned Cleaner reads the same
projection, and the reviewed database function decides who that is.

### Uncertainty is surfaced, not hidden

The projection reports `needsConfirmation` per object — true when the condition
is absent, or scored below the review threshold the vision prompts state to the
model ("below 0.5 needs customer review"), and the customer has not already
confirmed it. Each room reports `unresolvedCount`, and the scan reports the
total. An uncertain grade a customer can see and correct is useful; the same
grade presented as a finding is what changes what someone is charged on
evidence nobody checked.

### Client

`public/room-scan-overlay.js` now returns the structured reading alongside the
display labels it always returned. Geometry is deliberately left behind: the
boxes describe one frame of one camera pose and mean nothing outside it.

The overlay also reports which capture path produced the scan. A live
viewfinder gets detection, tracking, quality gating and movement guidance; a
photo chosen from the phone's own camera gets none of them, and recording the
two as one device class would average their accuracy together and hide the gap.

`public/landlord-journey.js` holds the reading in memory only, exactly like the
photographs beside it — `saveDraft()` serialises into `sessionStorage`, and a
description of the inside of someone's home does not belong there before the
authenticated private draft exists to receive it. The scan is saved immediately
after the draft is created and before the photo upload and submission, because
the recording function accepts a scan only while the request is still a draft.

## Honest limitations

- **The save is best-effort.** A failure is logged and the booking continues. A
  booking must not fail because a description of a worktop could not be stored,
  but this does mean a scan can still be lost when the endpoint is unavailable.
  There is no retry queue yet; that belongs with the `processing_jobs`
  idempotency work in Phase 8.
- **Nothing about price has changed.** This phase captures structure and
  nothing else. Duration is still derived from the count of task lines, exactly
  as before. Connecting condition and object count to the pricing engine is
  Phase 6, and it will run in shadow against human-reviewed quotes before it
  influences anything a customer pays.
- **The correction endpoint has no interface yet.** Corrections made inside the
  scanner overlay are still applied in the browser and reach storage as part of
  the recorded scan. The per-object correction API exists and is tested, but
  the review screen that would call it after the draft exists is Phase 3 work.
- **Measurements remain absent**, and deliberately so under the web-only
  decision. See §11 of the audit.
- **Photographs are still not pixel-redacted.** Metadata is stripped; a face, a
  screen or a document in frame is not. That is gap G9 and is Phase 8 work.
- **Attribution names the confirmation model only.** A scan whose objects came
  from several walking reads records the tier that produced the confirmation,
  not a per-object model trail.
- **The taxonomy exists in four places.** `room-condition-vocabulary.mjs` is the
  owner, imported by the vision reader and the scan service. Migration 073's
  `CHECK` constraint is a fourth statement of the same list and cannot import
  it; it is the boundary of last resort, and any change to the vocabulary has
  to be made there in the same commit.

## Verification completed

- All 73 migrations applied to a fresh PostgreSQL 16 database, followed by both
  role-grant files.
- `db/integration/structured-room-scan-behaviour.sql` passes: recording,
  idempotent retry, re-scan replacement, `unknown` stored as absence, `clean`
  stored as `clean`, independent confidences, correction with original
  retained, removal surviving as a correction record, consent defaulting to
  false, object and room bounds, an unrelated Landlord refused both read and
  write, an uninvited Cleaner refused the read, and a submitted request
  refusing both a replacement scan and a correction.
- The full `tools/postgres-integration-runner.mjs` suite passes end to end
  against a real database, with fixtures removed.
- `db/integration/deployment-verification.sql` gained a migration-73 block, and
  it was proven to **fail** when the runtime role is granted direct table
  access and when a required function grant is missing.
- `tests/scan-service.mjs` passes, and was mutation-tested: coercing an unknown
  condition to a grade, letting a client-supplied model claim through, and
  hiding low-confidence readings each make it fail.
- Full project syntax, text-encoding, database-asset and dependency-lock gates
  pass. 93 of 94 registered test files pass; `tests/data-relocation.mjs` fails
  identically on an unmodified checkout in this container and is unrelated to
  this change.
- No existing table, API, price, booking rule or scanner behaviour was altered.
