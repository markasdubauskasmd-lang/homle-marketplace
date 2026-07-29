// The shared vocabulary for room condition.
//
// These lists were already written out twice — once in the vision reader's two
// schemas, once in the CHECK constraints of migration 073 — and Phase 2 would
// have added a third copy in the scan service. The enumeration exists in the
// first place because free text produced "limescale", "lime scale", "scale",
// "water marks" and "calcium" for one thing, which no downstream code could
// group; three drifting copies of the fix would reintroduce the same problem a
// level up.
//
// The SQL constraint is a fourth statement of the same list and cannot import
// this file. It is the boundary of last resort rather than the definition, and
// any change here has to be made there in the same commit.

// What is visible on a surface. Adding a kind here means adding it to the
// vision schemas, to migration 073's CHECK, and to the display words below.
export const soilingKinds = Object.freeze([
  "dust", "grease", "limescale", "stain", "mould",
  "soap-scum", "food-debris", "pet-hair", "damage", "clutter"
]);

// How soiled one object is. 'clean' is a real answer — most of a well-kept home
// is clean — and is deliberately part of the scale rather than the absence of it.
export const itemConditions = Object.freeze(["clean", "light", "medium", "heavy"]);

// How soiled a whole room is. 'clean' is absent on purpose: a room's grade is
// the weight of what was found across it, and "this entire room needs nothing"
// is expressed by having no assessment rather than by a grade meaning zero.
export const roomConditions = Object.freeze(["light", "medium", "heavy"]);

// Where an object came from. 'detector' is the on-device model, 'vision' the
// server-side reader, 'manual' a person — either a hand-marked item or one the
// customer renamed. Kept distinct because a correction rate is only meaningful
// against detections nobody has already touched.
export const objectOrigins = Object.freeze(["detector", "vision", "manual"]);

// Below this, the reading is shown as needing a look rather than presented as a
// finding. It matches the threshold the vision prompts state to the model
// ("below 0.5 needs customer review"), so the number the reader was told to
// respect is the same one the product acts on.
export const conditionReviewThreshold = 0.5;

export function isSoilingKind(value) {
  return soilingKinds.includes(String(value || "").toLowerCase().trim());
}

export function isItemCondition(value) {
  return itemConditions.includes(String(value || "").toLowerCase().trim());
}

export function isRoomCondition(value) {
  return roomConditions.includes(String(value || "").toLowerCase().trim());
}
