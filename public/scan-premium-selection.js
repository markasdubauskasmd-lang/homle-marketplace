// Customer choices are separate from detected evidence and never correction labels.
// Keep every generated line either in the editable checklist or visibly held by
// an optional choice; do not silently split compound instructions.
const text = (value) => String(value || "").trim().replace(/\s+/g, " ");
const words = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const premiumChoiceId = (roomName, code) => JSON.stringify([text(roomName).toLowerCase(), text(code).toLowerCase()]);

function isRestriction(line) {
  const body = text(line.includes(":") ? line.slice(line.indexOf(":") + 1) : line);
  return /^(?:please\s+)?(?:do\s+not|don['’]?t|dont|never|skip|exclude|avoid|no\s+need\s+to|not\s+(?:necessary|required)\s+to|leave\b.*\balone)\b/i.test(body)
    || /\b(?:does(?:\s+not|n['’]?t)\s+(?:need|require)|(?:is|are)\s+(?:excluded|out\s+of\s+scope))\b/i.test(body);
}

function refersTo(line, option) {
  const colon = line.indexOf(":");
  if (colon >= 0 && words(line.slice(0, colon)) !== words(option.roomName)) return false;
  const body = words(colon >= 0 ? line.slice(colon + 1) : line);
  // Exterior-only appliance wiping does not request the deep-clean extra.
  if (/\b(exterior|outside|external)\b/.test(body) && !/\b(inside|interior|deep)\b/.test(body)) return false;
  return option.names.some((name) => name && (" " + body + " ").includes(" " + name + " "));
}

export function createPremiumPlan(rooms = [], taskLines = [], config = {}) {
  const options = [];
  const seen = new Set();
  for (const room of rooms) {
    const roomName = text(room.name || room.roomName);
    for (const object of room.objects || []) {
      const code = text(object.inventoryKey || object.code).toLowerCase();
      const premium = Object.hasOwn(config.premiumItems || {}, code) ? config.premiumItems[code] : null;
      if (!premium) continue;
      const id = premiumChoiceId(roomName, code);
      if (seen.has(id)) continue;
      seen.add(id);
      const names = [words(object.label), words(code), words(premium.label)];
      if (code === "fridge") names.push("refrigerator");
      if (code === "oven") names.push("ovens");
      options.push({ id, code, roomName, label: premium.label, pence: premium.pence,
        names: [...new Set(names)], task: roomName + ": Clean the " + text(object.label || premium.label).toLowerCase() + " — " + premium.label });
    }
  }
  for (const option of options) option.restricted = taskLines.some((line) => isRestriction(text(line)) && refersTo(text(line), option));
  const groups = [];
  const baseTasks = [];
  for (const raw of taskLines) {
    const line = text(raw);
    if (!line) continue;
    const ids = options.filter((option) => refersTo(line, option)).map((option) => option.id);
    if (ids.length && !isRestriction(line)) groups.push({ text: line, ids });
    else baseTasks.push(line);
  }
  for (const option of options) {
    if (!option.restricted && !groups.some((group) => group.ids.includes(option.id))) {
      groups.push({ text: option.task, ids: [option.id] });
    }
  }
  return { options, groups, baseTasks };
}

export function premiumScope(plan, baseTasks, selectedIds) {
  const selected = new Set(selectedIds.filter((id) => !plan.options.some((option) => option.id === id && option.restricted)));
  const tasks = [...baseTasks];
  for (const group of plan.groups) {
    if (group.ids.every((id) => selected.has(id))) tasks.push(group.text);
  }
  // A compound generated line is kept whole. Choosing just one of its extras
  // still needs an explicit task in the saved scope, not a charge without work.
  for (const option of plan.options) {
    if (selected.has(option.id) && !plan.groups.some((group) =>
      group.ids.includes(option.id) && group.ids.every((id) => selected.has(id)))) tasks.push(option.task);
  }
  const seen = new Set();
  return tasks.map(text).filter((line) => {
    const key = words(line);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function premiumBaseTasks(plan, tasks) {
  const managed = new Set([...plan.groups.map((group) => words(group.text)), ...plan.options.map((option) => words(option.task))]);
  return tasks.filter((line) => !managed.has(words(line)));
}

export function unselectedPremiumInTasks(plan, tasks, selectedIds) {
  const selected = new Set(selectedIds);
  return plan.options.find((option) => !selected.has(option.id)
    && tasks.some((line) => !isRestriction(text(line)) && refersTo(text(line), option))) || null;
}

export function selectedScanRooms(rooms, plan, selectedIds) {
  const selected = new Set(selectedIds);
  const optional = new Set(plan.options.map((option) => option.id));
  return rooms.map((room) => ({
    ...room,
    objects: (room.objects || []).map((object) => {
      const id = premiumChoiceId(room.name || room.roomName, object.inventoryKey || object.code);
      return optional.has(id) ? { ...object, selected: selected.has(id) && !plan.options.some((option) => option.id === id && option.restricted) } : { ...object };
    })
  }));
}


// A single reviewed note per room supplies the request, scan and photo handoffs.
// Do not truncate refusals to satisfy a shorter media-note field.
export function reviewedScanNotes(rooms = [], edits = {}, fallback = "") {
  const notes = {};
  const lines = [];
  for (const room of rooms) {
    const name = text(room.name || room.roomName);
    if (!name) continue;
    const key = name.toLowerCase();
    if (Object.hasOwn(notes, key)) throw new TypeError("Each room needs a distinct name before its instructions can be reviewed.");
    const note = String(Object.hasOwn(edits, key) ? edits[key] : room.note || "").trim();
    if (note.length > 1000) throw new TypeError(name + ": shorten the room instructions to 1,000 characters without removing safety restrictions.");
    notes[key] = note;
    if (note) lines.push(name + ": " + note);
  }
  const transcript = lines.length ? lines.join("\n") : Object.keys(edits).length ? "" : String(fallback || "").trim();
  if (transcript.length > 5000) throw new TypeError("Shorten the combined room instructions to 5,000 characters without removing safety restrictions.");
  return { notes, transcript };
}
