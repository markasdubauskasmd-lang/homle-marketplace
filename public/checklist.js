import { briefRoomOptions } from "./brief-readiness.js";

const spokenRoomAliases = new Map([
  ["lounge", "Living room"],
  ["wc", "Toilet"],
  ["bathroom one", "Bathroom 1"], ["bathroom two", "Bathroom 2"], ["bathroom three", "Bathroom 3"],
  ["bedroom one", "Bedroom 1"], ["bedroom two", "Bedroom 2"], ["bedroom three", "Bedroom 3"],
  ["bedroom four", "Bedroom 4"], ["bedroom five", "Bedroom 5"]
]);
const canonicalRooms = new Map(briefRoomOptions.map((room) => [room.toLowerCase(), room]));
const roomNames = [...new Set([...canonicalRooms.keys(), ...spokenRoomAliases.keys()])].sort((a, b) => b.length - a.length);
const roomPattern = roomNames.map((room) => room.replace(/\s+/g, "\\s+")).join("|");
const spokenRoomBoundaryLeadPattern = [
  "(?:in|for)\\s+(?:the\\s+)?",
  "(?:this|that)\\s+is\\s+(?:the\\s+)?",
  "(?:we(?:'re|\\s+are)|i(?:'m|\\s+am))\\s+(?:now\\s+)?(?:in|entering|moving\\s+into|walking\\s+into)\\s+(?:the\\s+)?",
  "now\\s+(?:in\\s+)?(?:the\\s+)?",
  "next\\s+(?:(?:room\\s+)?is|we\\s+(?:have|enter))\\s+(?:the\\s+)?"
].join("|");
const spokenRoomLeadPattern = `${spokenRoomBoundaryLeadPattern}|(?:moving|walking|going)\\s+(?:into|to)\\s+(?:the\\s+)?`;
const actionPattern = [
  "clean", "wipe", "mop", "vacuum", "hoover", "sweep", "dust", "scrub",
  "disinfect", "sanitise", "sanitize", "polish", "degrease", "descale", "remove",
  "empty", "wash", "dry", "tidy", "organise", "organize", "change", "replace",
  "make", "strip", "rinse", "clear", "take", "put", "leave", "avoid", "focus",
  "check", "do not", "don't", "dont", "skip", "exclude", "no need to",
  "not necessary to", "not required to"
].join("|");
const passiveActions = new Map([
  ["cleaned", "Clean"], ["cleaning", "Clean"], ["wiped", "Wipe"], ["wiping", "Wipe"],
  ["mopped", "Mop"], ["mopping", "Mop"], ["vacuumed", "Vacuum"], ["vacuuming", "Vacuum"],
  ["hoovered", "Vacuum"], ["hoovering", "Vacuum"], ["swept", "Sweep"], ["sweeping", "Sweep"],
  ["dusted", "Dust"], ["dusting", "Dust"], ["scrubbed", "Scrub"], ["scrubbing", "Scrub"],
  ["disinfected", "Disinfect"], ["disinfecting", "Disinfect"],
  ["sanitised", "Sanitise"], ["sanitising", "Sanitise"], ["sanitized", "Sanitise"], ["sanitizing", "Sanitise"],
  ["polished", "Polish"], ["polishing", "Polish"], ["degreased", "Degrease"], ["degreasing", "Degrease"],
  ["descaled", "Descale"], ["descaling", "Descale"], ["removed", "Remove"], ["removing", "Remove"],
  ["emptied", "Empty"], ["emptying", "Empty"], ["washed", "Wash"], ["washing", "Wash"],
  ["dried", "Dry"], ["drying", "Dry"], ["tidied", "Tidy"], ["tidying", "Tidy"],
  ["organised", "Organise"], ["organising", "Organise"], ["organized", "Organise"], ["organizing", "Organise"],
  ["changed", "Change"], ["changing", "Change"], ["replaced", "Replace"], ["replacing", "Replace"],
  ["rinsed", "Rinse"], ["rinsing", "Rinse"], ["cleared", "Clear"], ["clearing", "Clear"]
]);

function canonicalRoom(value) {
  const room = value.trim().replace(/\s+/g, " ").toLowerCase();
  return spokenRoomAliases.get(room) || canonicalRooms.get(room) || "";
}

function taskObject(value) {
  return value.trim().replace(/^(?:The|A|An)\b/, (article) => article.toLowerCase());
}

function cleaningTarget(value) {
  const target = taskObject(value).replace(/^(?:the\s+)+/i, "").trim();
  return target ? `the ${target}` : "";
}

function describedConditionInstruction(value) {
  const description = value
    .replace(/^(?:there(?:'s|\s+is|\s+are)|you\s+can\s+see)\s+/i, "")
    .replace(/^(?:lots?\s+of|some|visible)\s+/i, "")
    .trim();
  const condition = description.match(/^(soap\s+scum|water\s+marks?|fingerprints?|smudges?|streaks?|limescale|cobwebs?|crumbs?|grease|grime|dust|marks?|spills?|stains?)\s+(on|around|in|inside|under|along)\s+(.+)$/i);
  if (!condition) return "";
  const kind = condition[1].toLowerCase();
  const position = condition[2].toLowerCase();
  const target = cleaningTarget(condition[3]);
  if (!target) return "";
  if (kind === "dust") return `Dust ${target}`;
  if (kind === "grease" || kind === "grime") return position === "on" ? `Degrease ${target}` : `Degrease ${position} ${target}`;
  if (kind === "limescale" || kind === "soap scum") return `Remove ${kind} from ${target}`;
  if (kind.startsWith("crumb") || kind.startsWith("cobweb") || kind.startsWith("spill") || kind.startsWith("stain") || kind === "mark" || kind === "marks" || kind.startsWith("water mark")) return `Remove ${kind} from ${target}`;
  return `Wipe ${kind} from ${target}`;
}

function activeCleaningInstruction(value) {
  if (/^(?:that(?:'s|\s+is)\s+(?:all|everything)(?:\s+in\s+here|\s+for\s+this\s+room)?|nothing\s+else(?:\s+in\s+here)?|moving\s+on|done(?:\s+in\s+here|\s+with\s+this\s+room)?)$/i.test(value)) return "";
  const leaveAlone = value.match(/^(.+?)\s+(?:should|must|needs?\s+to)\s+be\s+(?:left|kept)\s+(?:alone|as\s+is|in\s+place)$/i);
  if (leaveAlone) return `Leave ${taskObject(leaveAlone[1])} alone`;
  if (/^(?:the\s+)?sink\s+(?:is|looks?)\s+(?:full\s+of|filled\s+with)\s+(?:dirty\s+)?dishes$/i.test(value)) return "Wash the dishes in the sink";
  const excludedPassive = value.match(/^(.+?)\s+(?:does(?:\s+not|n't)|do(?:\s+not|n't))\s+(?:need|require)\s+(?:(?:to\s+be|any)\s+)?([a-z]+)$/i);
  if (excludedPassive) {
    const action = passiveActions.get(excludedPassive[2].toLowerCase());
    if (action) return `Do not ${action.toLowerCase()} ${taskObject(excludedPassive[1])}`;
  }
  const passive = value.match(/^(.+?)\s+(?:needs?|requires?)\s+(?:(?:to\s+be|some)\s+)?([a-z]+)$/i);
  if (passive) {
    const action = passiveActions.get(passive[2].toLowerCase());
    if (action) return `${action} ${taskObject(passive[1])}`;
    if (/^attention$/i.test(passive[2])) return `Clean ${taskObject(passive[1])}`;
  }
  const dirty = value.match(/^(.+?)\s+(?:is|are|looks?|look)\s+(?:(?:very|really|quite)\s+)?dirty$/i);
  if (dirty) return `Clean ${taskObject(dirty[1])}`;
  return describedConditionInstruction(value) || value;
}

function checklistTaskKey(value) {
  return value.toLowerCase()
    .replace(/\bthe\b/g, "")
    .replace(/\bhoover(?:ed|ing)?\b/g, "vacuum")
    .replace(/\bsanitiz(?:e|ed|ing)\b/g, "sanitise")
    .replace(/\borganiz(?:e|ed|ing)\b/g, "organise")
    .replace(/[^a-z0-9:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normaliseChecklistTask(value) {
  if (typeof value !== "string") return "";
  const task = activeCleaningInstruction(value
    .slice(0, 300)
    .trim()
    .replace(/^[-*\u2022\d.)\s]+/, "")
    .replace(/\s+/g, " ")
    .replace(/^(?:(?:um+|uh+|erm|okay|right|so)\b[, ]*)+/i, "")
    .replace(/^(?:please|could you|can you|the cleaner should|i(?:'d| would) like (?:you|the cleaner) to|i want (?:you|the cleaner) to|make sure (?:you|the cleaner)?|we need (?:you|the cleaner)?\s*to)\s+/i, "")
    .replace(/^(?:please|could you|can you)\s+/i, "")
    .replace(/^(?:don't|dont)\s+/i, "Do not ")
    .replace(/^(?:no need to|not necessary to|not required to)\s+/i, "Do not ")
    .replace(/^(?:skip|exclude)\s+(?:cleaning\s+)?(?:the\s+)?/i, "Do not clean the ")
    .trim());
  if (task.length < 3) return "";
  return `${task.charAt(0).toUpperCase()}${task.slice(1)}`.replace(/[,;.!?]+$/, "");
}

export function checklistFromTranscript(value) {
  if (typeof value !== "string") return [];
  const roomBoundary = new RegExp(`\\s+(?=(?:${spokenRoomBoundaryLeadPattern})(?:${roomPattern})\\b)`, "gi");
  const roomPrefix = new RegExp(`^(?:(?:${spokenRoomLeadPattern})|(?:the\\s+)?)(${roomPattern})\\b(?:\\s+now)?\\s*(?::|,|\\-|needs?\\s+(?:to\\s+be\\s+)?|should\\s+be\\s+)?\\s*`, "i");
  const actionBoundary = new RegExp(`(?:,\\s*|\\s+(?:and|then)\\s+)(?=(?:please\\s+)?(?:${actionPattern})\\b)`, "gi");
  const passiveBoundary = /(?:,\s*(?:and\s+)?|\s+and\s+)(?=(?:the\s+)?[^,]{1,80}\s+(?:needs?|requires?|is|are|looks?|look)\b)/gi;
  const conditionBoundary = /(?:,\s*(?:and\s+)?|\s+and\s+)(?=(?:(?:there(?:'s|\s+is|\s+are)|you\s+can\s+see|lots?\s+of|some|visible)\s+)?(?:soap\s+scum|water\s+marks?|fingerprints?|smudges?|streaks?|limescale|cobwebs?|crumbs?|grease|grime|dust|marks?|spills?|stains?)\b)/gi;
  const seen = new Set();
  const tasks = [];
  const sections = value
    .slice(0, 5000)
    .replace(/\bfinally\b/gi, ". __ROOM_RESET__. ")
    .replace(/\b(?:and then|after that|also)\b/gi, ".")
    .replace(/\bnext\b(?!\s+(?:(?:room\s+)?is|we\s+(?:have|enter)))/gi, ".")
    .replace(roomBoundary, ".")
    .split(/[.!?;\n]+/);

  let currentRoom = "";
  for (const sectionValue of sections) {
    let section = sectionValue.trim();
    if (!section) continue;
    if (section === "__ROOM_RESET__") {
      currentRoom = "";
      continue;
    }
    const roomMatch = section.match(roomPrefix);
    if (roomMatch) {
      currentRoom = canonicalRoom(roomMatch[1]);
      section = section.slice(roomMatch[0].length);
    }
    for (const clause of section.split(actionBoundary).flatMap((part) => part.split(passiveBoundary)).flatMap((part) => part.split(conditionBoundary))) {
      const task = normaliseChecklistTask(clause);
      if (!task) continue;
      const conciseTask = currentRoom && !task.toLowerCase().startsWith(`${currentRoom.toLowerCase()}:`)
        ? `${currentRoom}: ${task}`
        : task;
      const key = checklistTaskKey(conciseTask);
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push(conciseTask);
      if (tasks.length === 40) return tasks;
    }
  }
  return tasks;
}
