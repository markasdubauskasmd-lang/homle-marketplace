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

---

# Benchmark and shadow measurement

The audit set acceptance criteria in §10 and observed that none could be
measured. This is the measurement — in two halves, because the criteria split
into two genuinely different problems.

## Half one: the benchmark harness

`src/marketplace/scan-benchmark.mjs`, run by `tools/run-scan-benchmark.mjs`.

It computes real statistics over labelled cases: pooled object precision and
recall, duplicate rate, condition agreement, calibration, and complexity level
accuracy.

Three choices worth stating:

- **Cohen's kappa, not raw agreement.** Most objects in most homes are clean or
  light, so a grader that always answered "light" would score 90% raw agreement
  while being useless. Kappa subtracts chance agreement from the marginals —
  that grader scores **0**, which is what it deserves. There is a test asserting
  exactly this.
- **Pooled, not averaged per room.** A macro average gives a one-object bathroom
  the same weight as a twenty-object kitchen, flattering a model that is good at
  small rooms and hiding where the work actually is.
- **A rename is not two errors.** Comparison is on the identity key, for the
  same reason storage merges on it. "Tap" renamed to "Bathroom tap" would
  otherwise score as a miss *and* a false positive.

Calibration is reported as a Brier score, because a model can be accurate and
badly calibrated — and a badly calibrated confidence is worse than none here,
since the review threshold, the price range and the cleaner's "check this on
arrival" all read it as if it meant something.

### The dataset rule

**A case is either `"synthetic": true` or it carries real consent** —
`consent.recordedAt`, `consent.reference` so it can be withdrawn, and
`truth.labelledBy` by name. There is no third state, and a case that leaves it
unstated is refused. "Unlabelled" is exactly how a real customer's scan ends up
quoted as a fixture, or the reverse. No case may contain image data: a `data:`
URL in the repository is a photograph of somebody's home in the repository.

**Any run containing a synthetic case reports `datasetIsSynthetic: true` and can
never report `acceptable: true`, whatever the numbers say.**

### What the seed dataset is

`data/scan-benchmark/synthetic-seed.json` — **11 hand-written cases. Not real
rooms.** They prove the harness computes what it claims and lock in regression
behaviour: a change that grades a greasy kitchen as a light clean fails the
build. They span level 1 to level 5, low light, and the camera-fallback path, so
a later edit cannot quietly drop the hard cases to make everything look better.

Its current run reports one deliberately missed target — `duplicateRate`, because
`syn-10-duplicated-chair` reports four chair rows for a room holding two. The
metric working is the point, and there is an assertion so nobody "fixes" it by
tuning the model.

It carries **no `reviewedTotalPence`**. A reviewed total is a human's judgement
of a real job; inventing one would measure this project's arithmetic against its
own guess. Price error therefore reports **"not measured"** on the seed — which
is the truthful answer, and is why the second half exists.

## Half two: shadow observations from real bookings

Migration `076_scan_estimate_observations.sql`.

Price error does not need a labelling exercise. Every estimate produced against
a request is recorded; the agreed customer price already exists on the booking.
The error is the difference, and it accrues from ordinary trading.

- **No reviewed total is stored here.** The agreed price is joined from
  `bookings` at read time. Copying it in would create a second version of the
  truth that could drift from what the customer actually agreed.
- **A proposal is not a reviewed price.** Only bookings a Cleaner has accepted
  are compared. Comparing against a pending invitation would measure the
  estimate against another estimate.
- **One observation per request per rules version.** Reading a scan repeatedly
  must not weight one indecisive customer as heavily as a hundred bookings.
- **A refusal is recorded, and cannot carry a price.** How often the estimate
  declines to answer is itself worth watching; a CHECK constraint stops a
  refusal being stored with a total that would skew every aggregate.
- **Statistics, not rows.** `scan_estimate_shadow_report` returns an error
  distribution. An error distribution discloses nothing; a list of request ids
  and agreed prices is a list of what customers paid. Median, not mean, so one
  absurd outlier does not decide whether the estimate is trusted with money.
- **`sufficient` is false below 50 comparisons**, so a promising figure from nine
  bookings is not mistaken for evidence.
- **Recording never fails a read.** The database function returns `false` for a
  malformed observation and the service swallows failures. This measures the
  estimate; it is not the estimate.

`GET /api/marketplace/admin/pricing/scan-shadow-report` — Administrator only.

## What is measured now, and what is still a target

| Criterion | Status |
| --- | --- |
| Object precision / recall | **Harness works.** Figures exist only for fixtures. |
| Duplicate-object rate | **Harness works**, deliberately exercised by a fixture. |
| Condition agreement (κ) | **Harness works**, including the always-"light" degenerate case. |
| Confidence calibration | **Harness works** (Brier). |
| Complexity within ±1 | **Harness works.** |
| Price error | **Accrues automatically** from real bookings. Zero comparisons so far. |
| Measurement error | **Not measured.** Needs real scans with known ground-truth dimensions. |
| Completion / correction / crash-free rate | **Definitions exist** in `scan-telemetry.mjs`; not yet emitted. |
| Time to complete a room, latency | **Buckets defined**; not yet emitted. |

**No figure in this project has been measured on real homes.** Every accuracy
number remains a target. What has changed is that measuring them is now a matter
of collecting data rather than of building anything.

## The gate on leaving shadow mode

Phase 6's estimate influences nothing. It should continue to influence nothing
until `scan_estimate_shadow_report` reports `sufficient: true` — at least 50
accepted bookings — with `within15Percent` at or above 0.9. That is a business
decision at that point, not a technical one, and the report deliberately encodes
no verdict of its own.

---

# Closing the remaining gaps

## Retention (migration 078)

A structured scan is a description of the inside of somebody's home, and until
now it lived as long as the request did. Customer deletion worked; time never
removed anything.

Two periods, both operator-configurable without a deployment: a scan whose
request was never submitted or was withdrawn, and one a Cleaner was actually
sent to work from. The second cannot be set shorter than the first — it is the
evidence in any dispute about what was agreed.

Deletion is an hourly worker job in bounded `SKIP LOCKED` batches, granted only
to the restricted worker role. A deletion loop belongs to a supervised process,
not to a web request. It deletes the **session** and lets the cascade take rooms,
objects and measurements: deleting rows individually would leave a window in
which a scan existed with half its contents.

## Spoken instructions are persisted

Phase 4 classified every instruction and then nothing kept it, so the
do-not-touch panel was populated only when a caller happened to be holding the
classification — the most safety-critical part of the checklist was the least
reliable part.

Now stored against the request in their own shape, and the checklist **reads**
them rather than waiting to be handed them. Separate from the tasks on purpose:
a restriction stored as a checklist line is an operational hazard, and the
checklist text is where that mistake would be impossible to undo. The words are
retained because the customer said them, not because a model classified them —
if the classification is later found wrong, the instruction survives.

## Add-on catalogue

The pricing engine has always accepted add-ons and nothing defined them, so an
add-on could only come from a caller inventing one — a price component with no
reviewed amount behind it.

Estimates now resolve every add-on **against the catalogue**. A price sent by a
browser is ignored. Upsert is by code, so editing an amount cannot create a
second extra a customer could be charged twice for, and deactivating removes it
from what can be chosen without destroying the record of what was once charged.

## The scan save is retried

The scan lives only in the tab's memory and is deliberately never written to
browser storage, so one dropped response lost it for good. Now retried three
times with backoff — safe because recording is idempotent by session id, so a
retry after a response that never arrived is absorbed rather than duplicated.

Only failures that might pass next time are worth retrying, and when it
ultimately fails the customer is **told**: *"Your checklist is saved. The
detailed room findings could not be, so your cleaner will work from the
checklist alone."* The booking still proceeds on the reviewed checklist, which
is what it has always run on.

## Operations page

`/admin/scan-operations` — the shadow price error against accepted bookings, the
telemetry rates, the retention periods and the add-on catalogue.

It states the gate explicitly: **50 or more comparisons with 90% inside 15%.**
The report itself deliberately encodes no verdict, so the page names the
threshold rather than leaving it to be remembered. With nothing compared it says
so, and distinguishes that from an error of zero.

## Still outstanding, honestly

- **No physical device trial.** The browser test below is desktop Chromium with
  a synthetic camera. A real iPhone and Android handset over HTTPS is still
  required before activation, and it is the last thing between this feature and
  being trustworthy on a phone.
- **No benchmark dataset.** The harness and the consent rules exist; 200
  consented rooms do not.
- **Zero shadow comparisons.** The pipeline records them from ordinary trading;
  no accepted booking has been compared yet, so the estimate's error is still
  unknown.
- **Measurement capture has a model and no screen.** The geometry, the
  validation, the wording and the storage are complete and tested; the in-scanner
  tap-two-ends flow is not built. Measurements can be recorded through the API
  and by customer entry.
- **`processing_jobs` was not built**, and on reflection is not needed: the
  idempotency it was proposed for is already enforced by the unique constraints
  on the scan session and the measurement and observation tables. The real gap
  was the client-side retry above.

# Real-browser verification

`tests/browser-scan-pipeline.mjs` drives Chromium over the DevTools Protocol
using Node's built-in WebSocket — no new dependencies, because adding one would
break the locked dependency graph this project is gated on.

**It found a real defect.** The test fills a region with a checkerboard, redacts
it, and measures the surviving variance. It should collapse; it fell by about a
fifth. A single large `drawImage` downscale uses bilinear filtering, which
*samples* rather than averages, so a 20× reduction of a high-contrast pattern
keeps most of its contrast — and the "pixels are genuinely resampled away" claim
that function was written to make was false. A face would have been recoverable
from a photograph the code reported as redacted.

Fixed by downscaling through repeated halving, which averages each 2×2 block
properly. Verified in both directions: variance now collapses to under a quarter,
and reverting to the one-step downscale makes the test fail again.

That is the class of bug no unit test could have found — the maths was right, the
intent was right, and the platform did something other than what the API name
suggested.

The run also proves the module graph resolves in a browser, a live camera track
and a non-blank JPEG are produced, a detection box in the cropped-away part of a
portrait viewfinder is refused rather than clamped, every selector the review
renderer targets exists and the panel starts hidden, the pure models return
identical results in a browser, and the event reporter batches without a room
name reaching the payload.

The harness discovers ordinary Chrome or Chromium installations on Windows,
macOS and Linux, while an explicit `CHROMIUM_PATH` remains the first choice for
CI or an unusual installation. Discovery starts an isolated temporary browser
profile with the synthetic camera; it never opens or reads a person's normal
Chrome profile. A missing browser is reported with every checked location
instead of claiming that the scanner passed. This closes the earlier Windows
verification gap where the machine already had Chrome but the test silently
looked only for the Linux Playwright path and skipped the real pipeline.

# Phase 9 — the field report: a dirty sink graded CLEAN, no way to stop the mic

A real scan of a real kitchen produced "Sink CLEAN" over a sink stacked with
washing-up, offered a video mode nobody needed, gave the microphone no visible
stop control, and felt slow on the shutter. Each was traced to a root cause
before anything was changed.

## Root causes found

1. **"clean" was the cheapest possible verdict.** The prompt demanded evidence
   for every grade *except* clean, applied the same 0.5 confidence bar to clean
   as to the grades customers actually review, and said nothing about the
   commonest real case — a fixture covered by the thing that makes it dirty.
   And the errors are not symmetric: a wrong "medium" is reviewed and removed in
   a tap; a wrong "clean" says there is nothing to look at, so nobody ever
   checks it and the job is silently under-scoped.
2. **Walking frames destroyed the evidence before the model saw it.** The
   confirmation frame had already been raised to 1600px/0.90 because condition
   is fine texture; the walking keyframes — whose grades fill the live list and
   survive into the saved room — were still 1024px/0.72.
3. **Marginally soft frames were billed.** The quality gate refused a paid read
   only once the "hold still" nag fired (detail < 4.5); a frame at detail 5 —
   soft enough to dissolve residue film, sharp enough to escape the nag — was
   still spent.
4. **A grade with no confidence score at all counted as settled**
   (`confidence !== null && confidence < 0.5` — the null case fell through).
5. **The stylesheet hid the only stop control.** `.voice.recording
   .voice-done{display:none}` removed the note panel's single button during
   recording, leaving stop to an unlabelled toggle across the screen.
6. **The last synchronous JPEG encode sat on the shutter.** `drawVisibleRegion`
   ended in `toDataURL` at 1600px — measured at 44–57ms of main-thread block on
   desktop Chromium, several times that on a phone — on exactly the press the
   Landlord is watching for a response. The capture flash the stylesheet defined
   was never triggered by anything.
7. **The video deck button was a second way to do what the walking scan already
   does**, and a media-mode decision handed to a customer.

## What changed

- Asymmetric review thresholds, everywhere the grade is consumed: "clean" needs
  conditionConfidence ≥ 0.7 (`cleanConditionReviewThreshold`, mirrored in the
  client model) to be presented as settled; soiled grades keep 0.5; a null
  confidence now asks instead of asserting. Applied in the vocabulary, the scan
  projection, the complexity assessment, the live inventory row ("clean? check"
  instead of CLEAN), and the finish-scan warning.
- The prompts require evidence for clean ("clear empty basin, no marks"), state
  the 0.7 rule, and spell out the covered-fixture case: a sink stacked with used
  crockery is food-debris and clutter, never clean. `readingSchemaVersion` → 2,
  because a v1 "clean" and a v2 "clean" are different claims.
- Walking keyframes: 1024px/0.72 → 1280px/0.80, and paid reads now require
  measured detail ≥ 5.5 (`keyframeDefaults.minimumDetail`), above the 4.5 nag
  threshold. Refusal spends nothing — the same view is read when it sharpens.
- Every settled finding carries a recommended action — "Descale the tap",
  "Degrease the extractor hood — heavy build-up, allow soaking time" — from a
  deterministic owned mapping (`recommendedAction`), never from model output,
  and never for a verdict still awaiting confirmation.
- The microphone: Stop and Cancel in the panel header while recording, Done and
  Delete while reviewing; the mic button itself is labelled Stop while live;
  Cancel restores the note to exactly its pre-recording text; a blocked
  permission, a missing microphone and an empty recording each get their own
  message; the timer visibly restarts per recording.
- The deck video button is gone; the video path survives only on the
  camera-blocked recovery card, where a phone with a blank live camera genuinely
  needs it. The vacated slot holds the typed-note entry; the shutter now says
  "Finish room".
- The capture path encodes through the asynchronous Blob path, the flash fires
  on the press, the shutter locks during the encode, and post-await guards drop
  a stale encode if the view was left or frozen meanwhile.

## Measured

`tests/browser-scan-controls.mjs` (Chromium, 1600×900 noise frame — the JPEG
worst case): the old synchronous path blocked the main thread **44–57ms** per
capture; the new path holds it **~0.3ms**, a queued task runs after **~0.4ms**,
and the encode completes in the background in ~45–50ms. Shutter press to frozen
frame: **61–136ms**, with the flash on the press itself. Phone CPUs are
typically 3–6× slower, so the removed stall was of the order of 150–350ms per
press on the devices this scanner is for.

The same suite drives the real overlay: recording shows Stop/Cancel and hides
the review controls, speech reaches the editable transcript, Cancel restores the
pre-recording note, a permission error names the blocked microphone, Delete
clears the note, the deck has no video button and the recovery card still has
one, capture flashes immediately and freezes to the confirm step, and closing
the scanner mid-recording stops the recognition session and resolves null.

## Honest limitations

- **The grading fixes are prompt- and threshold-level; they are not verified
  against real dirty sinks.** The benchmark dataset is still the 11 synthetic
  fixtures. The asymmetric threshold guarantees an unsure clean is *asked
  about* rather than asserted — that is a UX guarantee, not a model-accuracy
  one. The 200-room consented dataset remains the only way to measure the
  actual false-clean rate.
- **The wave animation is a recording indicator, not a level meter.** Web
  Speech exposes no audio levels, and opening a second microphone capture just
  to animate bars would double the permission surface for decoration.
- **`minimumDetail = 5.5` is a reasoned floor, not a calibrated one.** It only
  narrows the 4.5–5.5 band (frames below 4.5 were already refused), so its
  worst case is a slower first read in a low-texture room, but the number
  should be revisited once telemetry reports real detail distributions.
- **Still not a device trial.** Desktop Chromium with a synthetic camera and a
  stubbed speech service. A physical iPhone and Android handset over HTTPS
  remains required before activation, and is the only place real motion blur,
  thermal throttling and the native speech service can be tested.

# Phase 10 — closing the buildable gaps

The brief-versus-built audit left seven open items. Three can only be closed by
real phones and real bookings (the device trial, the consented dataset, shadow
comparisons accumulating). This phase closed the four that could be built or
decided from here.

## Measuring from the photo (was: model with no screen)

The review step now offers "Measure from the photo" on any room whose photo is
still in the tab: two taps across a known-size object, two taps across the
wall, and the server's own tolerance arithmetic answers with its band stated
before anything is kept. Only the two pixel spans travel — the photo never
leaves the page, and the new `photo-measurement` endpoint is compute-only.
Kept measurements persist against the saved scan at confirm, matched to the
server's room ids exactly like object corrections and equally non-fatal. On
the way in, typed figures get the standard 5% user-confirmed band rather than
reading as laser measurements, and length × width derives the floor area
server-side with the compounded band — never overwriting a customer's own
figure.

## Spoken guidance (was: captions only)

The guidance the scanner already computes is now spoken on request through the
on-device synthesiser: a speaker toggle in the scan header, off by default,
remembered per device. The one hard rule is pinned by test: it never speaks
while a voice note records, and starting a recording silences it mid-sentence
before the microphone opens — otherwise the phone would transcribe its own
instructions into the customer's note.

## Ground truth (was: accuracy unmeasurable even with traffic)

Migration 079 adds `room_scan_ground_truth`: an internal reviewer records what
each object's condition actually was, from the scan-operations page.
Administrator-only at every layer; verdicts overwrite on re-review and are
audited; labels cascade away with the scan they describe, so retention purges
and customer deletion take the derived data too; training consent is an
explicit attestation defaulting to no. The report is counts and confusion
pairs only — request ids never leave the database — and the agreement
statistic is the benchmark's own Cohen's kappa, so synthetic and real
measurements share one scale. The false-clean rate (the dirty-sink number) is
reported on its own, and anything under 50 reviews is labelled anecdote.

Verified against a real PostgreSQL 16: all 79 migrations, both grant files,
and the full integration suite including the new behaviour script — role
denial, queue privacy, overwrite-not-duplicate, false-clean counting, report
identifier hygiene, and the label dying with its scan.

## Segmentation (was: unbuilt with no recorded reason)

Now a documented decision in the audit's §11: no browser segmentation, because
without depth a pixel-perfect mask prices nothing better than a box, and the
verdicts customers pay for are bounded by the vision reader's image quality —
not box-versus-mask geometry. Revisit alongside any native tier.

## Honest limitations

- The measurement flow's assumption is stated in its bands, not solved: the
  reference and the measured span are taken to lie in the same plane, and the
  12% floor exists because a phone photograph cannot check that.
- The reviewer grades from their authorised view of the booking's photos; the
  review queue itself deliberately shows no media, so it links the request
  rather than the image. If reviewing at scale needs in-queue thumbnails, that
  is a separate, security-reviewed media surface.
- The ground-truth pipeline makes accuracy measurable, not measured: the
  figures stay empty until real scans are reviewed.
- Spoken guidance uses the device's installed voices; on a phone with none the
  toggle simply has no audible effect.
