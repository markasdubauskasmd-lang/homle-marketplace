import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  containmentRatio, deduplicateDetections, detectionMinimumScore,
  implausibleForRoom, joinSpokenText, preferredSpeechLanguage, cocoLabel
} from "../public/room-scan-model.js";

// Both failures these pin were photographed on a real phone against the deployed
// preview, not imagined: a bedside cabinet in a Bedroom came back as three boxes all
// labelled OVEN, and "tidy up the cupboards" was transcribed as "tidy tidy up tidy up
// the tidy up the cupboards tidy up the cupboards tidy up the cupboards put".

/* ── Speech: the handler must be idempotent ── */

// The real defect. `event.results` is cumulative and the old handler appended a delta
// from it, so an event covering already-final segments re-appended stored text. The
// handler now recomputes; these assert the join it recomputes through cannot itself
// reintroduce the repeat.

// The handler is where idempotency has to live, so that is what this simulates: the
// exact `onresult` sequence Android Chrome produces, including re-reporting segments
// that are already final. `results` is cumulative, and deliberately built WITHOUT a
// Symbol.iterator — `SpeechRecognitionResultList` is a WebIDL interface with an indexed
// getter and a length and nothing else, so a `for...of` over it throws. An earlier
// version of the fix used `for...of` and would have broken every result event.
function resultList(entries) {
  const list = { length: entries.length };
  for (const [index, entry] of entries.entries()) {
    list[index] = { isFinal: entry.isFinal, 0: { transcript: entry.text } };
  }
  return list;
}

// What the handler does, extracted so the sequencing can be asserted here.
function handleResults(base, results) {
  let finalText = "";
  let interim = "";
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    if (!result?.[0]) continue;
    if (result.isFinal) finalText += result[0].transcript;
    else interim += result[0].transcript;
  }
  return { note: joinSpokenText(base, finalText), interim };
}

// A Landlord says "tidy up the cupboards". This is the reported sequence.
const spokenEvents = [
  [{ isFinal: false, text: "tidy" }],
  [{ isFinal: false, text: "tidy up" }],
  [{ isFinal: true, text: "tidy up the" }],
  [{ isFinal: true, text: "tidy up the" }, { isFinal: false, text: " cupboards" }],
  [{ isFinal: true, text: "tidy up the" }, { isFinal: true, text: " cupboards" }]
];

let note = "";
let liveInterim = "";
for (const entries of spokenEvents) {
  const handled = handleResults("", resultList(entries));
  note = handled.note;
  liveInterim = handled.interim;
}
assert.equal(note, "tidy up the cupboards", `The reported transcript bug is back: ${JSON.stringify(note)}. Recompute the session from event.results rather than appending a delta.`);

// Replaying the final event must not change the note. This is the property the old
// handler lacked, and the whole reason the repeats appeared.
assert.equal(handleResults("", resultList(spokenEvents.at(-1))).note, note, "Replaying an identical result event changed the note, so the handler is still not idempotent.");

// An existing note is joined once, not re-joined per event.
const withExisting = handleResults("Clean the kitchen", resultList(spokenEvents.at(-1)));
assert.equal(withExisting.note, "Clean the kitchen tidy up the cupboards", `An existing note was not joined cleanly: ${JSON.stringify(withExisting.note)}`);
assert.equal(handleResults("Clean the kitchen", resultList([])).note, "Clean the kitchen", "An empty result list mutated the existing note.");

// A final and an interim arriving together: the interim is shown live, and committing
// must keep BOTH. `sessionFinal || lastInterim` kept only the final and dropped the
// rest of the sentence — a Landlord tapping the mic as they finished lost their words.
const mixed = handleResults("", resultList([{ isFinal: true, text: "tidy up" }, { isFinal: false, text: " the cupboards" }]));
assert.equal(mixed.interim.trim(), "the cupboards", "The interim tail was not surfaced for live display.");
assert.equal(
  joinSpokenText("", `${mixed.note} ${mixed.interim}`).replace(/\s+/g, " ").trim(),
  "tidy up the cupboards",
  "Committing a pending phrase kept only the finalised half of the sentence."
);
assert.ok(liveInterim === "" || typeof liveInterim === "string", "The live interim must always be a string so the transcript can be displayed for editing.");

assert.equal(joinSpokenText("a note", ""), "a note", "An empty result mutated the note.");
assert.equal(joinSpokenText("", ""), "", "Empty input did not produce an empty note.");

// Repetition is preserved, not repaired. An earlier version detected an overlapping
// phrase at the seam and dropped it, on the theory that a repeat meant the browser had
// re-recognised a restarted session's tail. Review showed that deleting real speech, so
// the heuristic is gone: what the Landlord said reaches the checklist intact, and the
// duplication bug is fixed at source by the handler recomputing rather than appending.
assert.equal(
  joinSpokenText("wipe the sink", "wipe the sink again"),
  "wipe the sink wipe the sink again",
  "An overlapping seam was silently removed. \"wipe the sink\" then \"wipe the sink again\" is two instructions, and dropping one changes what the Cleaner is asked to do."
);
assert.equal(joinSpokenText("clean the sink", "clean the sink"), "clean the sink clean the sink", "A deliberate repeat was swallowed. Guessing that a customer misspoke is not this helper's job.");

/* ── Speech: use the speaker's regional English model ── */

// The page is deliberately en-GB, but that is the interface language rather
// than evidence that every speaker has a UK accent. The phone already exposes
// its preferred regional English locale, which gives the browser speech engine
// a materially better model without adding another prompt or permission.
assert.equal(
  preferredSpeechLanguage("en-GB", ["en-US", "es-US"]),
  "en-US",
  "A US-English phone was forced through the UK speech model."
);
assert.equal(
  preferredSpeechLanguage("en-GB", ["hi-IN", "en-IN", "en-US"]),
  "en-IN",
  "An Indian-English phone did not receive its regional speech model."
);
assert.equal(
  preferredSpeechLanguage("en-GB", ["fr-FR", "en-AU"]),
  "en-AU",
  "The first usable regional English locale was not selected."
);
assert.equal(
  preferredSpeechLanguage("en-GB", ["fr-FR", "de-DE"]),
  "en-GB",
  "A non-English browser locale overrode the scanner's English fallback."
);
assert.equal(preferredSpeechLanguage("en-GB", []), "en-GB", "A missing browser locale lost the UK fallback.");
assert.equal(preferredSpeechLanguage("en", ["en"]), "en-GB", "Generic English did not resolve to the product's UK default.");
assert.equal(
  preferredSpeechLanguage("en-GB", ["javascript:alert(1)", "en_US"]),
  "en-US",
  "Malformed or underscore-delimited locale input was not normalised safely."
);
assert.equal(
  preferredSpeechLanguage("en-GB", { 0: "en-IE", length: 1 }),
  "en-IE",
  "A browser-style indexed language list was not supported."
);

/* ── ...and genuine continuation still reads naturally ── */

/* ── The overlay must not iterate the result list ── */

// `SpeechRecognitionResultList` has an indexed getter and a length and no
// `iterable<>` declaration, so it has no Symbol.iterator. A `for...of` over it throws
// on the very first result event — which is worse than the bug being fixed, because it
// takes out speech entirely rather than garbling it. Asserted against the source
// because the failure is a runtime TypeError in a browser this suite cannot run.
const overlaySource = readFileSync(new URL("../public/room-scan-overlay.js", import.meta.url), "utf8");
const resultHandler = overlaySource.slice(overlaySource.indexOf("recognition.onresult"), overlaySource.indexOf("recognition.onend"));
assert.ok(resultHandler, "The speech result handler could not be located to check it.");
assert.doesNotMatch(resultHandler, /for \(const \w+ of event\.results\)/, "The speech handler iterates `event.results` with for...of. SpeechRecognitionResultList is not iterable — this throws on every result event and takes out voice notes completely.");
assert.match(resultHandler, /index < event\.results\.length/, "The speech handler no longer walks `event.results` by index.");
assert.match(
  overlaySource,
  /recognition\.lang = preferredSpeechLanguage\(\s*document\.documentElement\.lang,\s*navigator\.languages \|\| navigator\.language\s*\)/,
  "The tested regional-English selector is not connected to the real speech recogniser."
);
// Rebuilt from the whole list, not from `resultIndex`. Starting at `resultIndex` is
// what made the handler an append-delta and produced the repeated phrases.
assert.doesNotMatch(resultHandler, /=\s*event\.resultIndex/, "The speech handler is reading from `event.resultIndex` again, which reintroduces the append-delta that repeated whole phrases.");

/* ── Detection: an oven is not plausible in a bedroom ── */

assert.ok(implausibleForRoom("Oven", "Bedroom"), "An oven in a bedroom is still accepted — the exact false label photographed on a real scan.");
assert.ok(implausibleForRoom(cocoLabel("oven"), "Bedroom"), "The mapped COCO label for `oven` is not filtered in a bedroom.");
assert.ok(implausibleForRoom("Toilet", "Kitchen") && implausibleForRoom("Bed", "Bathroom"), "Obvious cross-room impossibilities are accepted.");
// Real room names are not the bare presets.
assert.ok(implausibleForRoom("Oven", "Main bedroom") && implausibleForRoom("Oven", "Bedroom 2") && implausibleForRoom("Oven", "Upstairs bathroom"), "A room named the way people actually name rooms is not matched.");

/* ── ...and the filter must never eat a legitimate item ── */

assert.ok(!implausibleForRoom("Oven", "Kitchen"), "An oven was suppressed in a kitchen.");
assert.ok(!implausibleForRoom("Sink", "Bathroom") && !implausibleForRoom("Bed", "Bedroom") && !implausibleForRoom("Sofa", "Living room"), "An item was suppressed in the room it belongs in.");
// Fails open: an unknown room, or a label nobody listed, is always allowed.
assert.ok(!implausibleForRoom("Oven", "Utility"), "An unrecognised room name suppressed an item instead of failing open.");
assert.ok(!implausibleForRoom("Oven", "") && !implausibleForRoom("", "Bedroom"), "Missing input was not handled by allowing the detection through.");
assert.ok(!implausibleForRoom("Radiator", "Bedroom"), "A label that is not on any list was suppressed.");
// A name that names two rooms plausibly contains the items of both. Matching the first
// entry would suppress by declaration order — the sofa out of a kitchen-diner, the
// toilet out of a bedroom with an ensuite.
assert.ok(!implausibleForRoom("Sofa", "Kitchen / living room"), "A kitchen-diner suppressed its sofa by matching the kitchen rules first.");
assert.ok(!implausibleForRoom("Toilet", "Bedroom with ensuite"), "A bedroom with an ensuite suppressed its toilet.");
assert.ok(!implausibleForRoom("Oven", "Kitchen / living room"), "A two-room name did not fail open for every label.");

/* ── Detection: three boxes on one cabinet are one object ── */

// The photographed case. Same class, stacked vertically over one chest of drawers.
// Each pair's union is large so IoU stays under 0.68 — which is why all three used to
// survive — but each smaller box sits almost entirely inside the tallest.
const cabinet = [
  { className: "oven", score: 0.66, x: 34, y: 46, width: 60, height: 30 },
  { className: "oven", score: 0.63, x: 34, y: 58, width: 60, height: 18 },
  { className: "oven", score: 0.62, x: 34, y: 66, width: 60, height: 12 }
];
const merged = deduplicateDetections(cabinet);
assert.equal(merged.length, 1, `One chest of drawers produced ${merged.length} boxes. Same-class boxes largely inside one another are the same object.`);
assert.equal(merged[0].score, 0.66, "Merging kept a lower-confidence reading over the best one.");

// Two genuinely separate objects of the same class must both survive.
const twoChairs = [
  { className: "chair", score: 0.8, x: 5, y: 50, width: 20, height: 30 },
  { className: "chair", score: 0.75, x: 60, y: 50, width: 20, height: 30 }
];
assert.equal(deduplicateDetections(twoChairs).length, 2, "Two separate chairs were merged into one.");
// A small item genuinely sitting on a large one is a different class, so it survives.
const cupOnTable = [
  { className: "dining table", score: 0.9, x: 10, y: 40, width: 70, height: 40 },
  { className: "cup", score: 0.8, x: 30, y: 45, width: 8, height: 8 }
];
assert.equal(deduplicateDetections(cupOnTable).length, 2, "A cup on a table was suppressed — containment must only merge boxes of the same class.");

// The boundary that matters: two chairs standing side by side, one partly behind the
// other. They overlap, but nowhere near enough to be one object, and both must survive.
// Containment deliberately merges only heavy overlap — a chair almost wholly inside
// another's box is genuinely ambiguous, and a merged item costs a tap to re-add while a
// wrongly labelled one reaches the price.
const overlappingChairs = [
  { className: "chair", score: 0.8, x: 20, y: 50, width: 24, height: 30 },
  { className: "chair", score: 0.78, x: 34, y: 52, width: 24, height: 30 }
];
assert.equal(deduplicateDetections(overlappingChairs).length, 2, `Two side-by-side chairs were merged. Containment must need heavy overlap, not any overlap — measured ${containmentRatio(overlappingChairs[0], overlappingChairs[1]).toFixed(2)}.`);

assert.equal(containmentRatio({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 5, height: 5 }), 1, "A fully contained box did not report full containment.");
assert.equal(containmentRatio({ x: 0, y: 0, width: 10, height: 10 }, { x: 50, y: 50, width: 10, height: 10 }), 0, "Disjoint boxes reported overlap.");

/* ── Confidence ── */

assert.ok(detectionMinimumScore > 0.5, `The detection threshold is ${detectionMinimumScore}. COCO-SSD's 0.5 default is the confidence at which a chest of drawers is reported as an oven.`);
assert.ok(detectionMinimumScore <= 0.75, `The detection threshold is ${detectionMinimumScore}, high enough to hide ordinary furniture. Missing items cost a tap; the manual box exists for that.`);

console.log("Scanner accuracy tests passed: recognised speech is joined idempotently and verbatim, regional English follows the speaker's phone with a UK fallback, cross-room impossible labels are dropped while the filter fails open, same-class boxes stacked on one object merge without collapsing genuinely separate items, and the confidence threshold is above the default that produced the false oven.");
