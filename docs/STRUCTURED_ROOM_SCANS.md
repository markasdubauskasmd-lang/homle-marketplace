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

---

# Phase 3 — cleaning complexity

`src/marketplace/cleaning-complexity.mjs` turns the stored per-object readings
into a level on a defined 1–5 scale, with the evidence that produced it.

## The scale

| Level | Meaning |
| --- | --- |
| 1 | Light maintenance clean |
| 2 | Standard clean |
| 3 | Heavy clean |
| 4 | Deep-clean conditions |
| 5 | Specialist review required |

Level 5 is **not** "very dirty". It means a person must look before a cleaner is
sent, and the honest trigger is confirmed mould at medium or heavy: that is a
health matter and a treatment, not harder cleaning. A level 5 assessment
deliberately recommends **no bookable service** — sending someone to choose a
service for a property that needs looking at first is the failure the level
exists to prevent.

## Three properties that are load-bearing

1. **Pure and deterministic.** No clock, no randomness, no I/O, no model call.
   The same scan always produces the same level, which is what makes a disputed
   assessment answerable rather than a matter of opinion.
2. **Derived, never stored.** The observations are the record; the assessment is
   a reading of them. Changing a weight therefore re-scores every historical
   scan and can be evaluated against them — impossible once a score has been
   frozen into a row. `complexityModelVersion` identifies the weights used.
3. **It refuses to fill gaps.** Where the scan was unsure it produces a question
   for the customer rather than a number.

## What it will not do

- **An empty scan is not level 1.** It is `assessed: false`, "Not assessed". An
  empty scan reported as a light clean is a confident answer built on nothing.
- **Dust is not scored on top of its own grade.** Dust is the default soiling
  and how much of it there is *is* the condition. Scoring it twice would inflate
  the most common finding in every home.
- **Damage is not priced as cleaning.** A cracked tile is not cleanable. It
  scores zero and becomes a question instead, because the cleaner still needs to
  know and must not be booked as though they will fix it.
- **Uncertain mould does not escalate anyone.** Mould the reader itself scored
  below the review threshold becomes a question, not a specialist referral.
  A customer-confirmed reading counts whatever the model scored it.
- **A low-confidence level is still reported, never as settled.** Withholding it
  leaves the customer with nothing; `provisional` and `confidence` say what it
  rests on.

A whole property in heavy condition escalates one level above the heaviest
single room, because three heavy rooms is a bigger job than one heavy room in an
otherwise tidy home, and the heaviest-room rule alone cannot see that.

## Honest limitations

- **Duration is uncalibrated** and labelled `durationCalibrated: false`
  everywhere it appears. Nothing consumes it — the booking journey still derives
  duration from the reviewed checklist exactly as before.
- **Quantity multiplies linearly.** Cleaning four identical chairs is genuinely
  faster per chair than cleaning one, but by how much is a measurement, not a
  guess, and it is measurable from the job durations the platform already
  records. Guessing a batching discount now would bake an invented number into
  every assessment. Linear over-states slightly, which is stated rather than
  hidden.
- **The weights are not yet operator-configurable.** They are exported, frozen
  and versioned so they can be audited and changed in one place; the admin
  interface arrives with the pricing work in Phase 6.
- **No measurements feed it**, under the web-only decision. Room size is
  represented only by how many things were found in the room.

# Phase 4 — structured voice instructions

`speech-summary.mjs` now classifies every spoken instruction as **request**,
**restriction**, **safety** or **preference**, alongside the subject it concerns
and whether the speaker stressed it.

The failure this ends: *"do not move the paperwork"* and *"degrease the
worktops"* both arrived as lines on the same to-do list, leaving the cleaner to
work out which was which — which is exactly what they should not have to do.

## Design decisions

- **One provider call, two views.** `summariseDetailed()` returns the checklist
  lines and the structured instructions from a single reading. Two calls could
  disagree about what was said, and the checklist and the restrictions must not
  be able to contradict each other.
- **`tasks` is byte-identical to before**, refusal lines included. Filtering
  restrictions out of the checklist before anything renders them separately
  would silently drop a customer instruction — worse than showing it in the
  wrong place. The structured view is additive until the interface catches up.
- **The fallback falls the safe way.** A response carrying no `kind` — one
  already in flight during a deployment — resolves a refusal to `restriction`,
  never to `request`. A refusal the model itself labelled `request` is corrected
  to `restriction`, because that is the one combination that cannot be honoured.
- **A fabricated priority is not trusted.** Anything other than an explicit
  `high` resolves to `normal`, so nothing can push a cleaner's attention onto
  something the customer never stressed.
- **Classification degrading never costs the checklist.** If structuring fails
  while the lines are usable, the Landlord keeps what they had before.

The Landlord dashboard now names restrictions and safety warnings in the
walkthrough status — *"4 room tasks understood from your walkthrough, including
1 do-not instruction and 1 safety warning"* — so a customer can check that a
restriction was understood as one.

## Honest limitations

- **The cleaner-facing rendering is Phase 7.** The classification exists, is
  returned by the API and is surfaced to the Landlord, but the do-not-touch
  panel in the cleaner's checklist arrives with the operational output.
- **Structured instructions are not yet persisted.** They travel with the
  walkthrough response. Storing them against the request is small and belongs
  with the checklist work, where there is something that consumes them.
- **Classification is a model judgement**, unlike the complexity level. It is
  bounded by an enum and corrected where it contradicts the refusal flag, but
  whether a given sentence is a safety warning or a restriction is not
  deterministic and is not claimed to be.

---

# Phase 5 — measurement without a depth sensor

Under the web-only decision there is no `sensor-measured` path, and this phase
does not pretend otherwise. What is left is genuinely useful and genuinely
imprecise: an object of known real size in the same frame gives a scale, and
that scale gives everything else in the same plane.

The whole design is about making the imprecision explicit rather than rounding
it away. **Every value has a `method`, a `confidence` and a `toleranceMm`, and
there is no code path that produces one without them.**

## Reference objects

| Reference | Real size | Uncertainty |
| --- | --- | --- |
| Bank card (ISO/IEC 7810 ID-1) | 85.6 × 53.98 mm | ±0.5 mm |
| A4 sheet (ISO 216) | 210 × 297 mm | ±2 mm |
| Internal door (BS 4787 convention) | 762 × 1981 mm | ±40 mm |
| Brick (BS EN 1996) | 215 × 65 mm | ±10 mm |
| Plug socket faceplate (BS 1363) | 86 × 86 mm | ±3 mm |

The uncertainty column is the point. A bank card is manufactured to a standard
and is exact to a fraction of a millimetre; a "standard" UK door is standard
only by convention and varies by tens of millimetres between houses. Treating
those as equally good references would produce two answers with the same stated
confidence and very different real accuracy.

## The perspective floor

`minimumReferenceRelativeTolerance` is **12%**, and no arithmetic can go below
it. A single frame cannot know whether the reference and the thing being
measured are the same distance from the lens. A bank card held 200 mm nearer the
phone than the wall behind it is reported as a larger card, and everything
scaled from it comes out proportionally small. Pixel arithmetic cannot see that
error, so it is added by hand and cannot be optimised away.

Nothing a web application measures is described as **high** confidence — the
top band for an estimate is *medium*. Only a figure a person confirmed is high,
and even that carries a small non-zero tolerance by default, because a stated
zero would make a typed figure look like a laser reading.

## Compounding

Relative tolerances add. Two lengths each good to ±12% produce a floor area good
to ±24%, which is exactly why a photographed floor area must never be quoted as
a figure. It is reported with its band, or it is not reported. An area derived
from two confirmed figures stays confirmed; an area derived from anything
estimated does not, whatever the arithmetic works out to.

A measurement worse than ±35% is marked `usable: false`. "Between 1.8 and 6.2
metres" is not a measurement, it is a way of appearing to answer.

## How a measurement is written

> Length 3.4m ± 0.4m, estimated from a bank card in the photo

That tells the truth in the same space that "3.4m" tells a lie.

## Storage

Migration `074_room_scan_measurements.sql`. `method`, `tolerance_mm` and
`confidence` are all `NOT NULL`, and a CHECK constraint makes an estimate with a
zero tolerance physically unstorable — only a person may state a figure with no
band, and only about their own home. A measurement whose provenance is unknown
is worse than no measurement, because it sits in the same column as the others
and looks like them.

`sensor` is present in the enum but unreachable: the service and the database
function both refuse it, so adding a native path later is a code change rather
than a migration on a table already holding customer data.

Recording replaces a room's measurements wholesale, because a floor area derived
from a length and a width must never outlive the figures it came from. A
correction retains `original_value_mm` for the same reason object corrections
retain theirs.

`PUT /api/marketplace/cleaning-requests/:id/room-scan/rooms/:roomScanId/measurements`

## Honest limitations

- **No capture interface yet.** The maths, the storage, the API and the
  labelling are complete and tested; the in-scanner flow that asks the customer
  to place a bank card against a wall and drag a line is not built. Measurements
  can be recorded today through the API and by customer entry.
- **±12% is optimistic for a careless capture** and pessimistic for a careful
  one. It is a fixed floor, not a measurement of the actual perspective error in
  a given frame, which a single photograph cannot recover.
- **Coplanarity is assumed and unverified.** Nothing checks that the reference
  is actually on the surface being measured.
- **Wall area is a supported subject but nothing derives it**, because it needs
  a ceiling height and a perimeter, and a perimeter needs more than two lengths.
- **No measurement influences price.** That is Phase 6, and only in shadow.

---

# Phase 6 — pricing

`src/marketplace/scan-pricing.mjs` turns a scan into an explained estimate using
business rules only. Two constraints shape it, both from the brief:

- **No generative model is the pricing authority.** The vision reader produces
  observations; money is produced by arithmetic over a stored ruleset.
- **This does not replace the existing quote.** `booking-workflow.mjs quote()`
  remains the only thing that prices a real booking. What this adds is a
  customer-facing estimate and a labour-minutes figure that can be compared
  against reviewed quotes before anything depends on it.

`isEstimate` is true on every result and no argument clears it.

## Refusing to price is a real answer

An unassessed scan and a level-5 scan both return `priceable: false` with a
reason. `normalizedPricingRuleset` forces the level-5 multiplier to zero, so no
operator can put a price on "a person needs to look at this first" by editing a
rate.

## What the estimate will not assume

A room with no usable measurement contributes **no size adjustment at all**.
Assuming an average room size would put a number in the price that nothing
observed. Unanswered questions widen the quoted range, so a scan the customer
has not finished checking produces a visibly vaguer price rather than a falsely
precise one. The breakdown lines sum to the total exactly — a breakdown that
does not add up is worse than none, because it looks checkable and is not.

## Operator-owned rates

Migration `075_scan_pricing_rulesets.sql`, append-only. Publishing writes a new
version and retires the previous one, so an estimate given last month can still
be explained by the rules that produced it; an `UPDATE` would silently rewrite
the past. A partial unique index enforces exactly one live version, every rate
carries a `CHECK`, and each change records who made it and why in `audit_logs`.

`/admin/scan-pricing` shows the change in plain words before publishing —
"£28.00 → £30.00" is the sentence that catches a mistyped figure — and refuses a
heavier level priced below a lighter one, which is almost always transposed
fields rather than an intended discount.

## Honest limitations

- **Nothing consumes the estimate yet.** It is returned on the scan read and
  shown nowhere in the booking flow. `shadowComparison()` exists to measure the
  error against reviewed quotes; that measurement has **not been run**, because
  it needs real scans and real reviewed totals.
- **The labour figure is the uncalibrated one** from Phase 3.
- **Add-ons have no catalogue.** The estimate accepts them; nothing defines them.

# Phase 7 — cleaner checklist

`src/marketplace/cleaner-checklist.mjs`. The rule: **the cleaner should not need
to interpret raw AI output.** A confidence score and a soiling enum are the right
shape for pricing and audit and the wrong shape entirely for somebody standing in
a kitchen with a cloth.

So it translates rather than forwards. `conditionConfidence: 0.31` becomes "check
this when you arrive". Grease on a heavy hob becomes "Degrease the Hob", high
priority, and a degreaser on the packing list. "Medium" becomes "needs a
dedicated product".

**Restrictions and safety warnings are sections, never tasks** — and are listed
even when they name a room nobody scanned, so "the dog is in the back room"
cannot be missed because that room was not part of the scan.

A clean object is deliberately not a task: listing everything the scanner saw
turns a checklist into an inventory and a cleaner stops reading it. An unusable
measurement is withheld, because a cleaner planning around "3.4m ± 1.2m" is worse
served than one told nothing.

A level-5 or unassessed scan produces a checklist that says it must not be
dispatched, but still produces one so an operator can read it first.

The cleaner job page gains **one additive panel**, hidden when there is nothing
to say, rendered after the existing task list and swallowing its own errors. No
existing cleaner page, route, workflow or style was changed.

## Honest limitations

- **Voice instructions are not persisted**, so the do-not-touch panel is populated
  only when a caller supplies them. Storing them against the request is the
  remaining piece.
- **Nothing marks a checklist "approved".** It is derived on read from the
  approved scan; a separate approval state is not modelled.

# Phase 8 — hardening

## Redaction (closes G9)

`public/room-photo-redaction.js` erases people, screens and documents **on the
device**, using the detector the scanner is already running, so a frame
containing a face is never uploaded. A server-side redactor would still mean the
unredacted image crossed the network and sat in a bucket.

It hooks into `drawVisibleRegion` — the single place every uploaded frame, crop
source and read frame is produced — so a call site added later inherits it
instead of having to remember it. Regions come from the **raw detector output**,
not the tracker: a person is filtered out by `implausibleForRoom` and by the
tracking threshold, and neither is a reason to publish their face.

Erasure is downscale-and-redraw, not `filter = "blur()"`. A canvas filter is
reversible in principle and unsupported in some mobile canvas implementations,
which would fail open.

The customer is told what was removed, named rather than counted, and a frame
that is more than 60% erased is refused — it is no longer a photograph of a
room, and it is the frame most likely to have contained somebody.

**This is a mitigation, not a guarantee.** COCO-SSD detects a whole person, a
television, a laptop, a phone and a book. It does **not** detect a face as such,
a framed photograph on a wall, a letter lying flat on a worktop, or a name on an
envelope. `book` is included knowing it will sometimes blur an actual book — a
blurred paperback costs a customer nothing; a legible letter reaching a stranger
costs them a great deal.

## Telemetry

`src/marketplace/scan-telemetry.mjs` measures the acceptance criteria the audit
set and could not previously measure. Built so that breaking the "never send raw
customer images to analytics" rule requires deleting code rather than forgetting
to add it: the allowed shape is an explicit list of metric names, a fixed
dimension allowlist, and bounded numbers. Everything else is dropped.

Not recorded: images, object labels, room names, notes, transcripts, or any
identifier. Timings are bucketed, because an exact duration is a weak identifier
when joined against anything else. A rate with no denominator is `null`, not
zero — "no scans completed" and "no scans started" are different facts.

## Honest limitations

- **Telemetry is not yet emitted or collected.** The module, its allowlist and
  its rate definitions are complete and tested; the call sites in the scanner
  and the monitoring adapter that drains it are not written. Nothing measures
  the acceptance criteria in production yet.
- **No benchmark dataset exists.** §10 of the audit specifies 200 rooms; none
  have been collected, so no precision, recall, agreement or price-error figure
  in this project has been measured. Every accuracy claim remains a target.
- **No retention policy or automatic deletion job.** Customer-initiated scan
  deletion works; time-based expiry does not exist.
- **Model rollback is still an environment variable.** Readings are now
  attributed to a model version, so a regression is traceable; reverting is
  still a redeploy.
