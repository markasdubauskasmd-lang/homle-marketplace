const rooms = [
  "kitchen", "bathroom", "bedroom", "living room", "lounge", "dining room",
  "hallway", "stairs", "office", "utility room", "communal area", "entrance",
  "toilet", "wc", "shower room", "conservatory", "balcony", "other area"
];

const roomPattern = rooms.map((room) => room.replace(/\s+/g, "\\s+")).join("|");
const actionPattern = [
  "clean", "wipe", "mop", "vacuum", "hoover", "sweep", "dust", "scrub",
  "disinfect", "sanitise", "sanitize", "polish", "degrease", "descale", "remove",
  "empty", "wash", "dry", "tidy", "organise", "organize", "change", "replace",
  "make", "strip", "rinse", "clear", "take", "put", "leave", "avoid", "focus",
  "check", "do not", "don't"
].join("|");

function titleCaseRoom(value) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function normaliseChecklistTask(value) {
  if (typeof value !== "string") return "";
  const task = value
    .slice(0, 300)
    .trim()
    .replace(/^[-*\u2022\d.)\s]+/, "")
    .replace(/\s+/g, " ")
    .replace(/^(?:(?:um+|uh+|erm|okay|right|so)\b[, ]*)+/i, "")
    .replace(/^(?:please|could you|can you|the cleaner should|i(?:'d| would) like (?:you|the cleaner) to|i want (?:you|the cleaner) to|make sure (?:you|the cleaner)?|we need (?:you|the cleaner)?\s*to)\s+/i, "")
    .replace(/^(?:please|could you|can you)\s+/i, "")
    .trim();
  if (task.length < 3) return "";
  return `${task.charAt(0).toUpperCase()}${task.slice(1)}`.replace(/[.!?]+$/, "");
}

export function checklistFromTranscript(value) {
  if (typeof value !== "string") return [];
  const roomBoundary = new RegExp(`\\s+(?=(?:in|for)\\s+(?:the\\s+)?(?:${roomPattern})\\b)`, "gi");
  const roomPrefix = new RegExp(`^(?:(?:in|for)\\s+)?(?:the\\s+)?(${roomPattern})\\s*(?::|,|\\-|needs?\\s+(?:to\\s+be\\s+)?|should\\s+be\\s+)?\\s*`, "i");
  const actionBoundary = new RegExp(`(?:,\\s*|\\s+(?:and|then)\\s+)(?=(?:please\\s+)?(?:${actionPattern})\\b)`, "gi");
  const seen = new Set();
  const tasks = [];
  const sections = value
    .slice(0, 5000)
    .replace(/\b(?:and then|after that|next|also|finally)\b/gi, ".")
    .replace(roomBoundary, ".")
    .split(/[.!?;\n]+/);

  for (const sectionValue of sections) {
    let section = sectionValue.trim();
    if (!section) continue;
    const roomMatch = section.match(roomPrefix);
    const room = roomMatch ? titleCaseRoom(roomMatch[1].replace(/\s+/g, " ")) : "";
    if (roomMatch) section = section.slice(roomMatch[0].length);
    for (const clause of section.split(actionBoundary)) {
      const task = normaliseChecklistTask(clause);
      if (!task) continue;
      const conciseTask = room && !task.toLowerCase().startsWith(`${room.toLowerCase()}:`)
        ? `${room}: ${task}`
        : task;
      const key = conciseTask.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      tasks.push(conciseTask);
      if (tasks.length === 40) return tasks;
    }
  }
  return tasks;
}
