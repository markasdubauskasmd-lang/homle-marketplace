# Scan benchmark dataset

Cases the scanner is measured against. See §10 of
[the architecture audit](../../docs/ROOM_SCAN_ARCHITECTURE_AUDIT.md) for the
targets and the coverage the real dataset must reach.

## The only rule that matters here

**A case is either `"synthetic": true` or it carries real consent.** There is no
third state, and `benchmarkCaseErrors()` refuses a case that leaves it
unstated — because "unlabelled" is exactly how a real customer's scan ends up
quoted as a fixture, or a fixture gets quoted as evidence about real homes.

Any run containing a synthetic case reports `datasetIsSynthetic: true` and can
never report `acceptable: true`, whatever the numbers say.

## What is in here now

`synthetic-seed.json` — **11 hand-written cases. Not real rooms.** They exist to
prove the harness computes what it claims and to lock in regression behaviour:
a change that makes the complexity model grade a greasy kitchen as a light
clean will fail this file.

They say nothing about accuracy on real homes. No figure produced from this file
may be quoted as a precision, recall, agreement or price-error result.

## Adding a real case

A real case needs, and is refused without:

- `"synthetic": false`
- `consent.recordedAt` — when the customer agreed to this scan being used for
  measurement
- `consent.reference` — so the case can be found and removed when consent is
  withdrawn
- `truth.labelledBy` — the person who wrote the ground truth, by name

And it must not contain image data. Cases are structured readings; a `data:`
URL in this directory is a photograph of somebody's home in a git repository.

## Coverage the real dataset must reach

Minimum 200 rooms, spanning kitchen / bathroom / bedroom / living room /
hallway; light / medium / heavy condition; daylight / artificial / low light;
carpet / hard floor; cluttered / clear; at least six phone models across iOS and
Android including one four-year-old device.

`coverage` in the report says what a run actually contained, so a suspiciously
good result can be checked against whether the dataset held anything hard.

## Running it

```text
node tools/run-scan-benchmark.mjs
node tools/run-scan-benchmark.mjs data/scan-benchmark/synthetic-seed.json
```
