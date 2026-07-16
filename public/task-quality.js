const placeholderPattern = /^(?:test(?:ing)?|todo|tbc|tbd|n\/?a|none|unknown|something|anything|everything|etc\.?|as discussed|same as usual)$/i;
const vagueScopePattern = /^(?:(?:please\s+)?(?:clean|do|sort|deal with)\s+(?:everything|anything|it|this|that|all|all rooms?|all areas?)|(?:general|usual|normal)\s+clean(?:ing)?)$/i;
const exclusionPattern = /^(?:do\s+not|don't|dont|no|skip|exclude|avoid|leave)\b/i;
const actionPattern = /^(?:please\s+)?(clean|wipe|wash|scrub|dust|vacuum|hoover|mop|sweep|polish|disinfect|sanitise|sanitize|descale|degrease|rinse|dry|empty|remove|clear|tidy|change|replace|make|load|unload|steam|buff|organise|organize|collect|dispose|bag|refill|restock|air|bleach|soak|brush|squeegee|spot[ -]?clean|spot[ -]?treat|treat|iron|fold|put away|take out)\b/i;
const standaloneActionPattern = /^(?:vacuum|hoover|mop|sweep|dust)$/i;

function instructionFromTask(value) {
  const task = String(value || "").trim().replace(/\s+/g, " ").replace(/^[-*\u2022\d.)\s]+/, "");
  const separator = task.indexOf(":");
  if (separator > 0 && separator <= 120) return task.slice(separator + 1).trim();
  return task;
}

export function cleanerTaskQuality(value) {
  const instruction = instructionFromTask(value).replace(/[.!?]+$/, "").trim();
  if (instruction.length < 3) return { clear: false, reason: "missing-action" };
  if (placeholderPattern.test(instruction) || vagueScopePattern.test(instruction)) return { clear: false, reason: "vague" };
  if (/(.)\1{4,}/i.test(instruction)) return { clear: false, reason: "placeholder" };

  const words = instruction.match(/[a-z]+(?:'[a-z]+)?/gi) || [];
  if (!words.length) return { clear: false, reason: "missing-action" };
  if (exclusionPattern.test(instruction)) {
    return words.length >= 2
      ? { clear: true, reason: "boundary" }
      : { clear: false, reason: "missing-object" };
  }

  const action = instruction.match(actionPattern);
  if (!action) return { clear: false, reason: "missing-action" };
  if (standaloneActionPattern.test(instruction)) return { clear: true, reason: "action" };
  const remainder = instruction.slice(action[0].length).trim();
  if (!remainder || /^(?:up|it|this|that|everything|anything|all)$/i.test(remainder)) return { clear: false, reason: "missing-object" };
  return { clear: true, reason: "action" };
}

export function unclearCleanerTasks(values = []) {
  return (Array.isArray(values) ? values : []).map((value, index) => ({ index, value, ...cleanerTaskQuality(value) })).filter((result) => !result.clear);
}

export const cleanerTaskGuidance = "Make every checklist item a specific Cleaner action, for example ‘Wipe the worktops’ rather than ‘Kitchen’, ‘test’ or ‘clean everything’.";
