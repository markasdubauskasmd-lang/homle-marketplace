// Removes people, screens and documents from a room photograph before it
// leaves the device.
//
// Phase 8 of docs/ROOM_SCAN_ARCHITECTURE_AUDIT.md, closing gap G9. Until now a
// captured frame was metadata-stripped by the server and otherwise stored
// intact, so a person in the room, an unlocked laptop or a payslip on a desk
// reached the assigned Cleaner under a signed URL. Consent and access control
// were strong; the pixels were untouched.
//
// This runs on-device, using the detector the scanner is already running, so a
// frame containing a face is never uploaded in the first place. That is the
// only version of this worth having — a server-side redactor still means the
// unredacted image crossed the network and sat in a bucket.
//
// WHAT THIS IS NOT
//
// COCO-SSD detects a whole person, a television, a laptop, a phone and a book.
// It does not detect a face as such, a framed photograph on a wall, a letter
// lying flat on a worktop, or a name on an envelope. This removes the common,
// high-impact cases and it is a mitigation rather than a guarantee. The scanner
// still tells the customer to avoid photographing people and documents, because
// this cannot be relied on to catch them.

// Detector classes whose contents are somebody's private information rather
// than a cleaning surface.
//
// `book` is included knowing it will sometimes blur an actual book on a shelf.
// That trade is deliberate: a blurred paperback costs a customer nothing, and a
// legible letter reaching a stranger costs them a great deal. Every class here
// was chosen the same way — a false blur is cheap, a missed disclosure is not.
export const redactedClasses = Object.freeze(["person", "tv", "laptop", "cell phone", "book", "remote"]);

// Grown outward before blurring. A detector box is tight around what it found,
// and a tight box around a person leaves the edge of a face, a hand or a name
// badge outside it. 12% each way is enough to cover the usual slop without
// erasing the room around the subject.
export const redactionPadding = 0.12;

// How coarse the blur is, as a fraction of the region's smaller side. Applied
// by downscaling and drawing back up, so the detail is genuinely discarded
// rather than hidden behind a filter that a determined viewer could invert.
export const redactionCoarseness = 0.08;

export function shouldRedact(className) {
  return redactedClasses.includes(String(className || "").toLowerCase().trim());
}

/**
 * The regions to erase, in source-image pixels.
 *
 * Boxes are padded, clamped to the image and dropped if they are degenerate.
 * A box that covers essentially the whole frame is kept rather than skipped:
 * a photograph that is mostly a person is exactly the one that must not be
 * uploaded, and the caller decides what to do with an unusable frame.
 */
export function redactionRegions(detections, { width, height } = {}) {
  const imageWidth = Number(width);
  const imageHeight = Number(height);
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) return [];
  const regions = [];
  for (const detection of Array.isArray(detections) ? detections : []) {
    if (!shouldRedact(detection?.class ?? detection?.className ?? detection?.label)) continue;
    const box = Array.isArray(detection?.bbox) ? detection.bbox : [detection?.x, detection?.y, detection?.width, detection?.height];
    const [rawX, rawY, rawWidth, rawHeight] = box.map(Number);
    if (![rawX, rawY, rawWidth, rawHeight].every(Number.isFinite) || rawWidth <= 0 || rawHeight <= 0) continue;
    const padX = rawWidth * redactionPadding;
    const padY = rawHeight * redactionPadding;
    const left = Math.max(0, Math.floor(rawX - padX));
    const top = Math.max(0, Math.floor(rawY - padY));
    const right = Math.min(imageWidth, Math.ceil(rawX + rawWidth + padX));
    const bottom = Math.min(imageHeight, Math.ceil(rawY + rawHeight + padY));
    if (right - left < 1 || bottom - top < 1) continue;
    regions.push(Object.freeze({
      x: left, y: top, width: right - left, height: bottom - top,
      reason: String(detection?.class ?? detection?.className ?? detection?.label ?? "").toLowerCase().trim()
    }));
  }
  return Object.freeze(regions);
}

/**
 * How much of the frame is being erased.
 *
 * Overlapping regions are not double-counted, so a person holding a phone does
 * not read as covering more of the frame than they do.
 */
export function redactedAreaRatio(regions, { width, height } = {}) {
  const imageWidth = Number(width);
  const imageHeight = Number(height);
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight) || imageWidth <= 0 || imageHeight <= 0) return 0;
  const list = Array.isArray(regions) ? regions : [];
  if (!list.length) return 0;
  // A coarse grid rather than exact geometry: this decides whether to warn a
  // customer, and 1% precision is far more than that decision needs.
  const cells = 40;
  const covered = new Set();
  for (const region of list) {
    const startX = Math.floor((region.x / imageWidth) * cells);
    const endX = Math.ceil(((region.x + region.width) / imageWidth) * cells);
    const startY = Math.floor((region.y / imageHeight) * cells);
    const endY = Math.ceil(((region.y + region.height) / imageHeight) * cells);
    for (let cellY = Math.max(0, startY); cellY < Math.min(cells, endY); cellY += 1) {
      for (let cellX = Math.max(0, startX); cellX < Math.min(cells, endX); cellX += 1) covered.add(cellY * cells + cellX);
    }
  }
  return Math.round((covered.size / (cells * cells)) * 100) / 100;
}

// Past this the photograph is mostly not a room. The scanner asks for another
// one rather than uploading a frame whose useful content has been erased —
// which is also the frame most likely to have contained a person.
export const unusableRedactionRatio = 0.6;

/**
 * Erases the regions in place on a 2D canvas context.
 *
 * Downscale-and-redraw rather than a blur filter: the pixels are genuinely
 * resampled away, so there is nothing left to recover. `filter = "blur()"` is
 * reversible in principle and unsupported in some mobile canvas
 * implementations, which would fail open — the worst possible direction for
 * this particular operation.
 */
export function applyRedaction(context, regions, { document: documentRef } = {}) {
  const owner = documentRef || (typeof document === "undefined" ? null : document);
  if (!context || !owner || !Array.isArray(regions) || !regions.length) return 0;
  let applied = 0;
  for (const region of regions) {
    const width = Math.max(1, Math.round(region.width));
    const height = Math.max(1, Math.round(region.height));
    const smaller = Math.min(width, height);
    const scale = Math.max(1, Math.round(smaller * redactionCoarseness));
    const smallWidth = Math.max(1, Math.round(width / scale));
    const smallHeight = Math.max(1, Math.round(height / scale));
    const scratch = owner.createElement("canvas");
    scratch.width = smallWidth;
    scratch.height = smallHeight;
    const scratchContext = scratch.getContext("2d");
    if (!scratchContext) continue;
    scratchContext.imageSmoothingEnabled = true;
    scratchContext.drawImage(context.canvas, region.x, region.y, width, height, 0, 0, smallWidth, smallHeight);
    const previousSmoothing = context.imageSmoothingEnabled;
    context.imageSmoothingEnabled = false;
    context.drawImage(scratch, 0, 0, smallWidth, smallHeight, region.x, region.y, width, height);
    context.imageSmoothingEnabled = previousSmoothing;
    applied += 1;
  }
  return applied;
}

/**
 * What the customer is told, in their own terms.
 *
 * Named rather than counted. "1 person and 1 screen were blurred" lets someone
 * check the result against what they remember being in the room; "2 regions
 * redacted" does not.
 */
const redactionWords = Object.freeze({
  person: "person", tv: "screen", laptop: "screen", "cell phone": "phone",
  book: "document or book", remote: "handheld device"
});

export function redactionSummary(regions) {
  const list = Array.isArray(regions) ? regions : [];
  if (!list.length) return "";
  const counts = new Map();
  for (const region of list) {
    const word = redactionWords[region?.reason] || "personal item";
    counts.set(word, (counts.get(word) || 0) + 1);
  }
  const parts = [...counts.entries()].map(([word, count]) => `${count} ${count === 1 ? word : `${word}s`}`);
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `${joined} ${list.length === 1 ? "was" : "were"} blurred out of this photo before it was saved.`;
}
