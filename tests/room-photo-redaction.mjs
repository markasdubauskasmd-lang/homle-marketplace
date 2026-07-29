import {
  applyRedaction, redactedAreaRatio, redactedClasses, redactionPadding, redactionRegions,
  redactionSummary, shouldRedact, unusableRedactionRatio
} from "../public/room-photo-redaction.js";

function assert(condition, message) { if (!condition) throw new Error(message); }

const frame = { width: 1000, height: 1000 };

/* ── What gets erased, and why ─────────────────────────────────────────── */

// Every class here was chosen the same way: a false blur is cheap, a missed
// disclosure is not.
for (const className of ["person", "tv", "laptop", "cell phone", "book"]) {
  assert(shouldRedact(className), `${className} is not redacted, so somebody's private information can reach a stranger.`);
}
// Cleaning surfaces must survive, or the photograph stops being a room scan.
for (const className of ["sink", "oven", "chair", "sofa", "refrigerator", "toilet", "bed"]) {
  assert(!shouldRedact(className), `${className} is redacted, which would erase the thing being cleaned.`);
}
assert(shouldRedact("PERSON") && shouldRedact(" person "), "Redaction is case- or whitespace-sensitive.");
assert(!shouldRedact("") && !shouldRedact(null), "An unnamed detection was redacted.");
assert(redactedClasses.includes("book"), "Documents are not redacted.");

/* ── Boxes are grown before they are erased ────────────────────────────── */

// A detector box is tight around what it found, and a tight box around a
// person leaves the edge of a face or a name badge outside it.
{
  const [region] = redactionRegions([{ class: "person", bbox: [400, 400, 200, 200] }], frame);
  assert(region, "A person was not turned into a redaction region.");
  const expectedPad = Math.round(200 * redactionPadding);
  assert(region.x <= 400 - expectedPad + 1 && region.y <= 400 - expectedPad + 1,
    `The region was not grown outward: ${JSON.stringify(region)}`);
  assert(region.width >= 200 + expectedPad && region.height >= 200 + expectedPad, "The region was not grown on both sides.");
  assert(region.reason === "person", "The region did not record what it was hiding.");
}

// Growing must not run off the image.
{
  const [region] = redactionRegions([{ class: "person", bbox: [0, 0, 100, 100] }], frame);
  assert(region.x === 0 && region.y === 0, "A padded region ran off the top-left of the image.");
  const [corner] = redactionRegions([{ class: "person", bbox: [950, 950, 50, 50] }], frame);
  assert(corner.x + corner.width <= frame.width && corner.y + corner.height <= frame.height,
    "A padded region ran off the bottom-right of the image.");
}

// Both detector box shapes are accepted, because one comes from COCO-SSD and
// one from the scanner's own tracker.
{
  const fromTracker = redactionRegions([{ label: "laptop", x: 100, y: 100, width: 200, height: 150 }], frame);
  assert(fromTracker.length === 1, "A tracked box shape was not understood.");
}

// Malformed boxes are dropped rather than erasing an arbitrary rectangle.
{
  const regions = redactionRegions([
    { class: "person", bbox: [10, 10, 0, 50] },
    { class: "person", bbox: [10, 10, Number.NaN, 50] },
    { class: "person" },
    null
  ], frame);
  assert(regions.length === 0, "A malformed detection produced a redaction region.");
}
assert(redactionRegions([{ class: "person", bbox: [0, 0, 10, 10] }], { width: 0, height: 0 }).length === 0,
  "Regions were computed against an image with no dimensions.");

// A frame that is mostly a person is exactly the one that must not be
// uploaded, so it is kept and reported rather than silently skipped.
{
  const [region] = redactionRegions([{ class: "person", bbox: [0, 0, 1000, 1000] }], frame);
  assert(region && region.width === 1000, "A frame-filling person was dropped instead of erased.");
}

/* ── How much of the room is left ──────────────────────────────────────── */

{
  const quarter = redactionRegions([{ class: "person", bbox: [0, 0, 400, 400] }], frame);
  const ratio = redactedAreaRatio(quarter, frame);
  assert(ratio > 0.15 && ratio < 0.35, `A quarter-frame redaction measured ${ratio}.`);
  assert(redactedAreaRatio([], frame) === 0, "An unredacted frame reported a covered area.");

  // Overlapping regions must not double-count: a person holding a phone does
  // not cover more of the frame than they do.
  const overlapping = redactionRegions([
    { class: "person", bbox: [0, 0, 400, 400] },
    { class: "cell phone", bbox: [100, 100, 100, 100] }
  ], frame);
  assert(redactedAreaRatio(overlapping, frame) <= ratio + 0.05,
    "Overlapping redactions were counted twice.");

  const most = redactionRegions([{ class: "person", bbox: [0, 0, 900, 900] }], frame);
  assert(redactedAreaRatio(most, frame) > unusableRedactionRatio,
    "A photograph that is mostly a person was not reported as unusable.");
}

/* ── The erasure genuinely discards the pixels ─────────────────────────── */

// Downscale-and-redraw rather than a blur filter: `filter = "blur()"` is
// reversible in principle and unsupported in some mobile canvas
// implementations, which would fail open — the worst direction for this.
{
  const drawn = [];
  const scratchContexts = [];
  const fakeDocument = {
    createElement() {
      const scratch = {
        width: 0, height: 0,
        getContext() {
          const scratchContext = { imageSmoothingEnabled: false, drawImage: (...args) => drawn.push(["down", ...args]) };
          scratchContexts.push(scratchContext);
          return scratchContext;
        }
      };
      return scratch;
    }
  };
  const context = {
    canvas: { width: 1000, height: 1000 },
    imageSmoothingEnabled: true,
    filter: "none",
    drawImage: (...args) => drawn.push(["up", ...args])
  };
  const regions = redactionRegions([{ class: "person", bbox: [400, 400, 200, 200] }], frame);
  const applied = applyRedaction(context, regions, { document: fakeDocument });
  assert(applied === 1, "The redaction was not applied.");
  assert(drawn.some(([direction]) => direction === "down") && drawn.some(([direction]) => direction === "up"),
    "The region was not downscaled and redrawn.");
  assert(context.filter === "none", "A reversible canvas blur filter was used instead of resampling.");
  // Redrawing with smoothing on would reconstruct a soft, partly legible image.
  assert(drawn.filter(([direction]) => direction === "up").length === 1, "The region was redrawn more than once.");
  assert(context.imageSmoothingEnabled === true, "Canvas smoothing was left disabled for the rest of the frame.");
}
assert(applyRedaction(null, [], {}) === 0 && applyRedaction({}, [], {}) === 0, "Redaction ran without a context or regions.");

/* ── What the customer is told ─────────────────────────────────────────── */

// Named rather than counted: "1 person and 1 screen were blurred" lets someone
// check the result against what they remember being in the room.
{
  const regions = redactionRegions([
    { class: "person", bbox: [0, 0, 100, 100] },
    { class: "laptop", bbox: [200, 200, 100, 100] }
  ], frame);
  const summary = redactionSummary(regions);
  assert(summary.includes("1 person") && summary.includes("1 screen"), `The summary did not name what was hidden: ${summary}`);
  assert(summary.includes("before it was saved"), `The summary did not say when it happened: ${summary}`);
  assert(redactionSummary([]) === "", "An unredacted photo produced a redaction message.");

  const two = redactionRegions([
    { class: "person", bbox: [0, 0, 100, 100] },
    { class: "person", bbox: [300, 300, 100, 100] }
  ], frame);
  assert(redactionSummary(two).includes("2 persons") || redactionSummary(two).includes("2 people"),
    `Plural wording was wrong: ${redactionSummary(two)}`);
}

console.log("Room-photo redaction checks passed.");
