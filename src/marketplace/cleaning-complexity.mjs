import { cleanConditionReviewThreshold, conditionReviewThreshold, soilingKinds } from "./room-condition-vocabulary.mjs";

// Cleaning complexity, derived from what the scan actually recorded.
//
// Phase 3 of docs/ROOM_SCAN_ARCHITECTURE_AUDIT.md. Until now the only condition
// signal that survived a scan was a single light/medium/heavy per room, reduced
// worst-of, and it reached nothing downstream. This turns the stored per-object
// readings into a level on a defined scale, with the evidence that produced it.
//
// Three properties are deliberate and load-bearing:
//
//   1. **Pure and deterministic.** No clock, no randomness, no I/O, no model
//      call. The same scan always produces the same level, which is what makes
//      a disputed assessment answerable rather than a matter of opinion.
//
//   2. **Derived, never stored.** The observations are the record; this is a
//      reading of them. Changing a weight therefore re-scores every historical
//      scan and can be evaluated against them, which is impossible once a
//      score has been frozen into a row.
//
//   3. **It refuses to fill gaps.** Where the scan was unsure, this produces a
//      question for the customer rather than a number. A complexity level built
//      on readings nobody checked is exactly the confident-but-wrong assessment
//      the vision reader was written to avoid.
//
// It computes no price. Phase 6 connects this to the existing quote engine,
// in shadow, and only after the error against human-reviewed quotes is measured.

// Bumped whenever a weight or threshold changes. A level is only comparable to
// another level scored under the same version, and an assessment that could not
// say which version produced it would make every accuracy measurement useless.
export const complexityModelVersion = 1;

export const complexityWeights = Object.freeze({
  // How much work the grade itself implies. The gaps widen deliberately:
  // 'heavy' is not twice 'medium', it is soaking, scraping or repeated passes.
  condition: Object.freeze({ clean: 0, light: 1, medium: 3, heavy: 6 }),

  // Added on top of the grade, for soiling that needs a dedicated product or
  // technique rather than more of the same effort.
  //
  // 'dust' is zero on purpose: dust is the default soiling, and how much of it
  // there is IS the condition grade. Scoring it again would double-count the
  // most common finding in every home.
  //
  // 'damage' is zero on purpose too: a cracked tile is not cleanable. It is
  // reported separately, because a cleaner needs to know about it and must not
  // be priced as though they will fix it.
  soiling: Object.freeze({
    dust: 0, grease: 2, limescale: 2, mould: 4, stain: 1,
    "soap-scum": 1, "food-debris": 1, "pet-hair": 1, clutter: 1, damage: 0
  }),

  // Room load above which each level begins. Read against the heaviest room,
  // because the heaviest room is what decides whether a visit runs long.
  roomThresholds: Object.freeze({ light: 4, standard: 12, heavy: 24 }),

  // Uncalibrated. See estimatedMinutes below.
  baseRoomMinutes: 20,
  minutesPerLoadPoint: 4,
  minimumJobMinutes: 60,
  durationSpread: 0.35,
  // Above this, one person cannot finish inside a normal visit window.
  twoCleanerMinutes: 300
});

export const complexityLevels = Object.freeze([
  Object.freeze({ level: 1, code: "light-maintenance", label: "Light maintenance clean" }),
  Object.freeze({ level: 2, code: "standard", label: "Standard clean" }),
  Object.freeze({ level: 3, code: "heavy", label: "Heavy clean" }),
  Object.freeze({ level: 4, code: "deep-clean", label: "Deep-clean conditions" }),
  Object.freeze({ level: 5, code: "specialist-review", label: "Specialist review required" })
]);

// Only service codes the platform actually offers. A recommendation naming a
// service no Cleaner can be booked for is worse than no recommendation.
const serviceForLevel = Object.freeze({ 1: "regular-domestic", 2: "regular-domestic", 3: "deep-cleans", 4: "deep-cleans", 5: "" });

const equipmentForSoiling = Object.freeze({
  grease: "Degreaser for the cooking area",
  limescale: "Limescale remover",
  "soap-scum": "Bathroom cleaner for glass and tiles",
  mould: "Mould treatment and protective equipment",
  stain: "Stain treatment",
  "pet-hair": "Vacuum with a pet-hair tool",
  "food-debris": "Waste bags and surface sanitiser",
  clutter: "Time to clear and replace surface items",
  dust: "Microfibre cloths",
  damage: ""
});

const soilingWords = Object.freeze({
  dust: "dust", grease: "grease", limescale: "limescale", stain: "staining",
  mould: "mould", "soap-scum": "soap scum", "food-debris": "food debris",
  "pet-hair": "pet hair", damage: "damage", clutter: "clutter"
});

function number(value) {
  const supplied = Number(value);
  return Number.isFinite(supplied) ? supplied : 0;
}

function quantity(value) {
  const supplied = Number(value);
  return Number.isInteger(supplied) && supplied > 0 ? Math.min(supplied, 20) : 1;
}

function listSentence(values) {
  const parts = values.filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

// One object's contribution, and the reason for it.
//
// Quantity multiplies linearly. Cleaning three identical chairs is genuinely
// faster per chair than cleaning one, and a real model would say so — but by
// how much is a measurement, not a guess, and it is measurable from the actual
// job durations the platform already records. Guessing a batching discount now
// would bake an invented number into every assessment and make the later
// calibration harder to trust. Linear over-states slightly, which is stated
// here rather than hidden, and Phase 6 replaces it with the measured figure.
function objectLoad(object) {
  const condition = String(object?.condition || "");
  const conditionWeight = complexityWeights.condition[condition] ?? 0;
  const kinds = (Array.isArray(object?.soiling) ? object.soiling : [])
    .map((kind) => String(kind || "").toLowerCase())
    .filter((kind) => soilingKinds.includes(kind));
  const soilingWeight = kinds.reduce((total, kind) => total + (complexityWeights.soiling[kind] ?? 0), 0);
  const count = quantity(object?.quantity);
  return {
    load: (conditionWeight + soilingWeight) * count,
    conditionWeight,
    soilingWeight,
    kinds,
    count,
    // A grade nobody has checked and the model was unsure about is exactly what
    // must not silently become a level. It still contributes its load — hiding
    // it would understate the job — but it is counted as unresolved so the
    // assessment reports how much of itself rests on it. "clean" is held to the
    // higher vocabulary threshold: an uncertain clean contributes NO load, so
    // it is the one verdict whose error only ever understates the level.
    unresolved: object?.conditionConfirmed !== true
      && (!condition
        || number(object?.confidenceCondition) < (condition === "clean" ? cleanConditionReviewThreshold : conditionReviewThreshold))
  };
}

function levelFromLoad(load) {
  const { light, standard, heavy } = complexityWeights.roomThresholds;
  if (load <= light) return 1;
  if (load <= standard) return 2;
  if (load <= heavy) return 3;
  return 4;
}

export function levelDescriptor(level) {
  return complexityLevels.find((entry) => entry.level === level) || complexityLevels[0];
}

function roomAssessment(room) {
  const objects = Array.isArray(room?.objects) ? room.objects : [];
  const scored = objects.map((object) => ({ object, ...objectLoad(object) }));
  const load = scored.reduce((total, entry) => total + entry.load, 0);
  const itemCount = scored.reduce((total, entry) => total + entry.count, 0);
  const unresolved = scored.filter((entry) => entry.unresolved);
  const kinds = new Set();
  for (const entry of scored) for (const kind of entry.kinds) kinds.add(kind);
  // Only where the reader could actually see it. Mould asserted at a confidence
  // the reader itself called unreliable must not by itself send a customer to a
  // specialist — it becomes a question instead.
  const confirmedMould = scored.filter((entry) => entry.kinds.includes("mould")
    && ["medium", "heavy"].includes(String(entry.object?.condition || ""))
    && !entry.unresolved);
  return {
    roomName: String(room?.roomName || "").trim(),
    load,
    itemCount,
    level: levelFromLoad(load),
    soilingKinds: [...kinds],
    heaviest: scored.filter((entry) => entry.load > 0).sort((left, right) => right.load - left.load).slice(0, 3),
    damaged: scored.filter((entry) => entry.kinds.includes("damage")),
    confirmedMould,
    unresolved,
    scored
  };
}

// Why this level, from the evidence that produced it. Built from the objects
// actually scored rather than written as a template, so a reason that appears
// in the sentence can always be traced back to a stored reading.
function roomReason(room) {
  const parts = room.heaviest
    .filter((entry) => entry.conditionWeight >= complexityWeights.condition.medium || entry.soilingWeight > 0)
    .map((entry) => {
      const kinds = listSentence(entry.kinds.filter((kind) => kind !== "damage").map((kind) => soilingWords[kind]));
      const label = entry.count > 1 ? `${entry.count} × ${entry.object.label}` : entry.object.label;
      if (kinds && entry.object.condition) return `${entry.object.condition} ${kinds} on the ${label}`;
      if (kinds) return `${kinds} on the ${label}`;
      return `the ${label} is ${entry.object.condition}`;
    });
  if (!parts.length && room.itemCount) return `${room.itemCount} ${room.itemCount === 1 ? "item" : "items"} to clean in the ${room.roomName}`;
  if (!parts.length) return "";
  return `${listSentence(parts)} in the ${room.roomName}`;
}

function questionsFor(rooms) {
  const questions = [];
  for (const room of rooms) {
    // Named individually up to three, then counted. A prompt listing eleven
    // objects is one nobody answers.
    if (room.unresolved.length) {
      const named = room.unresolved.slice(0, 3).map((entry) => entry.object.label);
      const remainder = room.unresolved.length - named.length;
      questions.push({
        code: "condition-unclear",
        roomName: room.roomName,
        objectIds: room.unresolved.map((entry) => entry.object.objectId).filter(Boolean),
        question: `In the ${room.roomName}, how dirty ${named.length === 1 ? "is" : "are"} the ${listSentence(named)}${remainder > 0 ? ` and ${remainder} other ${remainder === 1 ? "item" : "items"}` : ""}?`
      });
    }
    // Mould the reader flagged but could not stand behind. Asking is the only
    // honest option: silently ignoring it risks sending an unprepared cleaner,
    // and silently trusting it escalates a customer to specialist review on
    // evidence the reader itself called unreliable.
    const uncertainMould = room.unresolved.filter((entry) => entry.kinds.includes("mould"));
    if (uncertainMould.length) {
      questions.push({
        code: "possible-mould",
        roomName: room.roomName,
        objectIds: uncertainMould.map((entry) => entry.object.objectId).filter(Boolean),
        question: `Is there mould on the ${listSentence(uncertainMould.slice(0, 3).map((entry) => entry.object.label))} in the ${room.roomName}?`
      });
    }
    if (room.damaged.length) {
      questions.push({
        code: "damage-noted",
        roomName: room.roomName,
        objectIds: room.damaged.map((entry) => entry.object.objectId).filter(Boolean),
        question: `The ${listSentence(room.damaged.slice(0, 3).map((entry) => entry.object.label))} in the ${room.roomName} looked damaged rather than dirty. Should the cleaner avoid ${room.damaged.length === 1 ? "it" : "them"}?`
      });
    }
  }
  return questions;
}

// Uncalibrated, and labelled as such everywhere it appears.
//
// It is produced because the brief asks the assessment for an expected
// duration, and withholding it entirely would be less useful than publishing it
// with its status attached. Nothing consumes it: the booking journey still
// derives duration from the reviewed checklist exactly as before. Phase 6
// calibrates it against the actual job durations the platform already records
// through live cleaning progress, which is the only thing that can turn this
// from an estimate into a measurement.
function estimatedMinutes(rooms) {
  if (!rooms.length) return { minutes: 0, lowMinutes: 0, highMinutes: 0, calibrated: false };
  const raw = rooms.reduce((total, room) => total + complexityWeights.baseRoomMinutes + room.load * complexityWeights.minutesPerLoadPoint, 0);
  const minutes = Math.max(complexityWeights.minimumJobMinutes, Math.round(raw / 5) * 5);
  return {
    minutes,
    lowMinutes: Math.max(complexityWeights.minimumJobMinutes, Math.round((minutes * (1 - complexityWeights.durationSpread)) / 15) * 15),
    highMinutes: Math.round((minutes * (1 + complexityWeights.durationSpread)) / 15) * 15,
    calibrated: false
  };
}

export function assessCleaningComplexity(scan = {}) {
  const rooms = (Array.isArray(scan?.rooms) ? scan.rooms : []).map(roomAssessment);
  const scoredObjects = rooms.reduce((total, room) => total + room.scored.length, 0);

  // No scan, or a scan with nothing in it, is not level 1. It is no assessment,
  // and saying so is the whole point of this module.
  if (!rooms.length || !scoredObjects) {
    return Object.freeze({
      assessed: false, level: 0, levelCode: "", levelLabel: "Not assessed",
      modelVersion: complexityModelVersion, confidence: "none", provisional: true,
      maximumRoomLoad: 0, itemCount: 0, indicators: Object.freeze([]),
      reasons: Object.freeze([]), explanation: "", questions: Object.freeze([]),
      recommendedService: "", recommendedCleaners: 0, equipment: Object.freeze([]),
      estimatedMinutes: 0, estimatedMinutesLow: 0, estimatedMinutesHigh: 0, durationCalibrated: false,
      rooms: Object.freeze([])
    });
  }

  const maximumRoomLoad = rooms.reduce((highest, room) => Math.max(highest, room.load), 0);
  const itemCount = rooms.reduce((total, room) => total + room.itemCount, 0);
  const unresolvedCount = rooms.reduce((total, room) => total + room.unresolved.length, 0);
  const resolvedRatio = scoredObjects ? (scoredObjects - unresolvedCount) / scoredObjects : 0;

  let level = rooms.reduce((highest, room) => Math.max(highest, room.level), 1);
  const reasons = [];

  // A whole property in heavy condition is a bigger job than one heavy room in
  // an otherwise tidy home, and the heaviest-room rule alone cannot see that.
  const heavyRooms = rooms.filter((room) => room.level >= 3);
  if (heavyRooms.length >= 3 && level < 4) {
    level = Math.min(4, level + 1);
    reasons.push(`${heavyRooms.length} rooms are in heavy condition rather than one`);
  }

  // Level 5 is not "very dirty". It is "this needs a person to look before a
  // cleaner is sent", and confirmed mould is the honest trigger: it is a health
  // matter and a treatment, not harder cleaning.
  const mouldRooms = rooms.filter((room) => room.confirmedMould.length);
  if (mouldRooms.length) {
    level = 5;
    reasons.unshift(`visible mould in the ${listSentence(mouldRooms.map((room) => room.roomName))}`);
  }

  for (const room of [...rooms].sort((left, right) => right.load - left.load).slice(0, 3)) {
    const reason = roomReason(room);
    if (reason) reasons.push(reason);
  }

  const descriptor = levelDescriptor(level);
  const confidence = resolvedRatio >= 0.8 ? "high" : resolvedRatio >= 0.5 ? "medium" : "low";
  const questions = questionsFor(rooms);
  const duration = estimatedMinutes(rooms);

  const presentSoiling = [...new Set(rooms.flatMap((room) => room.soilingKinds))];
  const equipment = presentSoiling.map((kind) => equipmentForSoiling[kind]).filter(Boolean);

  const indicators = [
    { code: "soiling-load", label: "Weight of graded soiling", value: Math.round(maximumRoomLoad), detail: "Heaviest single room, from per-object conditions and soiling types." },
    { code: "item-count", label: "Items to clean", value: itemCount, detail: "Counted by proven quantity, not by detection rows." },
    { code: "heavy-rooms", label: "Rooms in heavy condition", value: heavyRooms.length, detail: "Rooms scoring at level 3 or above on their own." },
    { code: "evidence-quality", label: "Readings the scan is sure of", value: Math.round(resolvedRatio * 100), detail: "Percentage of objects with a confirmed or confidently graded condition." },
    ...presentSoiling.map((kind) => ({
      code: `soiling:${kind}`, label: `Visible ${soilingWords[kind]}`,
      value: rooms.reduce((total, room) => total + room.scored.filter((entry) => entry.kinds.includes(kind)).length, 0),
      detail: `Objects reported with ${soilingWords[kind]}.`
    }))
  ];

  const explanation = reasons.length
    ? `${descriptor.label} because ${listSentence(reasons.slice(0, 3))}.`
    : `${descriptor.label} from ${itemCount} ${itemCount === 1 ? "item" : "items"} across ${rooms.length} ${rooms.length === 1 ? "room" : "rooms"}.`;

  return Object.freeze({
    assessed: true,
    level,
    levelCode: descriptor.code,
    levelLabel: descriptor.label,
    modelVersion: complexityModelVersion,
    confidence,
    // A level the scan is not sure of is still reported — withholding it would
    // leave the customer with nothing — but it is never reported as settled.
    provisional: confidence === "low" || questions.length > 0,
    maximumRoomLoad: Math.round(maximumRoomLoad),
    itemCount,
    indicators: Object.freeze(indicators.map((indicator) => Object.freeze(indicator))),
    reasons: Object.freeze(reasons),
    explanation,
    questions: Object.freeze(questions.map((question) => Object.freeze({ ...question, objectIds: Object.freeze(question.objectIds) }))),
    // Level 5 deliberately recommends nothing bookable. Sending someone to
    // choose a service for a property that needs looking at first is the
    // failure this level exists to prevent.
    recommendedService: serviceForLevel[level] || "",
    recommendedCleaners: level === 5 ? 0 : duration.minutes > complexityWeights.twoCleanerMinutes ? 2 : 1,
    equipment: Object.freeze(equipment),
    estimatedMinutes: duration.minutes,
    estimatedMinutesLow: duration.lowMinutes,
    estimatedMinutesHigh: duration.highMinutes,
    durationCalibrated: duration.calibrated,
    rooms: Object.freeze(rooms.map((room) => Object.freeze({
      roomName: room.roomName,
      level: room.level,
      levelLabel: levelDescriptor(room.level).label,
      load: Math.round(room.load),
      itemCount: room.itemCount,
      unresolvedCount: room.unresolved.length,
      soiling: Object.freeze([...room.soilingKinds]),
      reason: roomReason(room)
    })))
  });
}
