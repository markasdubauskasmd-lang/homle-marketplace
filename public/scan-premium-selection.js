// Customer choices are separate from detected evidence and never correction labels.
// Keep every generated line either in the editable checklist or visibly held by
// an optional choice; do not silently split compound instructions.
const text = (value) => String(value || "").trim().replace(/\s+/g, " ");
const words = (value) => text(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const premiumChoiceId = (roomName, code) => JSON.stringify([text(roomName).toLowerCase(), text(code).toLowerCase()]);

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
        names: [...new Set(names)], task: roomName + ": " + premium.label });
    }
  }
  const groups = [];
  const baseTasks = [];
  for (const raw of taskLines) {
    const line = text(raw);
    if (!line) continue;
    const ids = options.filter((option) => refersTo(line, option)).map((option) => option.id);
    if (ids.length) groups.push({ text: line, ids });
    else baseTasks.push(line);
  }
  for (const option of options) {
    if (!groups.some((group) => group.ids.includes(option.id))) {
      groups.push({ text: option.task, ids: [option.id] });
    }
  }
  return { options, groups, baseTasks };
}

export function premiumScope(plan, baseTasks, selectedIds) {
  const selected = new Set(selectedIds);
  const tasks = [...baseTasks];
  for (const group of plan.groups) {
    if (group.ids.every((id) => selected.has(id))) tasks.push(group.text);
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
  const managed = new Set(plan.groups.map((group) => words(group.text)));
  return tasks.filter((line) => !managed.has(words(line)));
}

export function unselectedPremiumInTasks(plan, tasks, selectedIds) {
  const selected = new Set(selectedIds);
  return plan.options.find((option) => !selected.has(option.id)
    && tasks.some((line) => refersTo(text(line), option))) || null;
}

export function selectedScanRooms(rooms, plan, selectedIds) {
  const selected = new Set(selectedIds);
  const optional = new Set(plan.options.map((option) => option.id));
  return rooms.map((room) => ({
    ...room,
    objects: (room.objects || []).map((object) => {
      const id = premiumChoiceId(room.name || room.roomName, object.inventoryKey || object.code);
      return optional.has(id) ? { ...object, selected: selected.has(id) } : { ...object };
    })
  }));
}
