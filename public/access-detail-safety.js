export const accessDetailsSafetyMessage = "Do not include door, gate, alarm or key-safe codes, passwords or hidden-key locations. Add exact access instructions only after a booking is accepted.";

const assignedSecret = /\b(?:(?:door|gate|alarm|access|entry|lockbox|key[\s-]*safe|keysafe)\s+)?(?:code|pin|password)\s*(?:is|=|:)\s*[a-z0-9#*_-]{3,32}(?![a-z0-9#*_-])/i;
const numberedSecret = /\b(?:(?:door|gate|alarm|access|entry|lockbox|key[\s-]*safe|keysafe)\s+)?(?:code|pin|password)\s+(?=[a-z0-9#*_-]{3,32}(?![a-z0-9#*_-]))(?=[a-z0-9#*_-]*\d)[a-z0-9#*_-]{3,32}(?![a-z0-9#*_-])/i;
const numberedLockbox = /\b(?:lockbox|key[\s-]*safe|keysafe)\s*(?:(?:code|pin)\s*)?(?:is|=|:|-)?\s*\d{3,12}\b/i;
const hiddenKeyLocation = /\bkeys?\s+(?:(?:is|are|was|were)\s+)?(?:hidden|kept|stored|left|located)\s+(?:under|behind|inside|in|at|above|below)\b/i;
const shorthandKeyLocation = /\bkeys?\s+(?:under|behind|inside)\s+(?:the\s+)?(?:mat|bin|plant|pot|door|brick|stone|box|meter)\b/i;
const lockboxLocation = /\b(?:lockbox|key[\s-]*safe|keysafe)\s+(?:(?:is|was)\s+)?(?:(?:hidden|located|kept)\s+)?(?:under|behind|inside|at)\b/i;
const alarmInstruction = /\b(?:arm|disarm|disable|reset)\s+(?:the\s+)?alarm\b.{0,32}\b\d{3,12}\b/i;

export function containsSensitiveAccessDetails(value) {
  const supplied = String(value || "").trim();
  if (!supplied) return false;
  return [assignedSecret, numberedSecret, numberedLockbox, hiddenKeyLocation, shorthandKeyLocation, lockboxLocation, alarmInstruction].some((pattern) => pattern.test(supplied));
}
