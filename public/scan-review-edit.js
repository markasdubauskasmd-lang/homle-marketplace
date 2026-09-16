import { inventoryKey, inventoryDisplayLabel, scanTaskRecordsFor, mergeScanTaskRecords, mergeSavedDetections } from "./room-scan-model.js";

export const scanRoomTypes = ["kitchen", "bathroom", "bedroom", "living-room", "dining-room", "hallway", "other"];
const key = value => String(value || "").trim().toLowerCase();
const text = (value, limit) => String(value || "").trim().slice(0, limit);
export function inferredRoomType(room) {
  if (scanRoomTypes.includes(room.roomType)) return room.roomType;
  const name = key(room.name || room.roomName).replace(/\s+/g, "-");
  return scanRoomTypes.find(type => name.includes(type)) || "other";
}
function changed(room, objects, removed = [], added = []) {
  return { ...room, objects, fixtures: objects.map(inventoryDisplayLabel),
    removedInventoryKeys: [...new Set([...(room.removedInventoryKeys || []), ...removed])],
    changedInventoryKeys: [...new Set([...(room.changedInventoryKeys || []), ...removed, ...added])]
  };
}

// Another view may miss an existing item. Only an explicit removal changes that
// scope; a new AI reading cannot undo a customer's earlier corrections either.
export function mergeReviewedRoomRescan(previous, reading) {
  const removed = new Set(previous.removedInventoryKeys || []);
  const protectedKeys = new Set(previous.changedInventoryKeys || []);
  const objects = (previous.objects || []).filter(item => !removed.has(item.inventoryKey)).map(item => ({...item}));
  for (const item of objects) {
    if (item.origin === "manual" || item.conditionConfirmed || item.quantityConfirmed) protectedKeys.add(item.inventoryKey);
  }
  const refreshed = new Set();
  const remapped = new Map();
  for (const item of reading.objects || []) {
    const identity = item.inventoryKey || inventoryKey(item.label);
    if (!identity || removed.has(identity)) continue;
    // A corrected label can be detected under its new canonical key. Reuse its
    // stable review identity rather than creating a second copy of that item.
    let index = objects.findIndex(old => old.inventoryKey === identity);
    if (index < 0) index = objects.findIndex(old => protectedKeys.has(old.inventoryKey) && inventoryKey(old.label) === inventoryKey(item.label));
    const targetKey = index < 0 ? identity : objects[index].inventoryKey;
    remapped.set(identity, targetKey);
    if (protectedKeys.has(targetKey)) continue;
    if (index < 0) objects.push({...item, inventoryKey:targetKey});
    else {
      const prior = objects[index];
      // Review objects and camera detections use distinct field names. Carry
      // the independent score and its evidence together through their merge.
      const detection = value => ({...value, conditionConfidence:value.confidenceCondition ?? value.conditionConfidence ?? null,
        note:value.evidence ?? value.note ?? ""});
      const merged = mergeSavedDetections([detection(prior)], [detection({...item, inventoryKey:targetKey})])[0];
      objects[index] = {...merged, confidenceCondition:merged.conditionConfidence ?? 0, evidence:merged.condition ? merged.note : ""};
      // A narrower view does not remove another previously visible appliance.
      // Retain its already correctly counted tasks as well as its quantity.
      if (objects[index].quantity !== item.quantity) { protectedKeys.add(targetKey); continue; }
    }
    refreshed.add(targetKey);
  }
  const newRecords = scanTaskRecordsFor(reading).map(record => ({...record,
    inventoryKeys:record.inventoryKeys.map(identity => remapped.get(identity) || identity)}))
    .filter(record => record.origin !== "vision" || !record.inventoryKeys.length
      || !record.inventoryKeys.every(identity => removed.has(identity) || protectedKeys.has(identity)));
  // Seeing an object again is not evidence that its previous work vanished.
  // Replace generated tasks only when the new read actually supplies linked
  // replacement work covering their complete scope.
  const replacementTaskKeys = new Set(newRecords.filter(record => record.origin === "vision").flatMap(record => record.inventoryKeys));
  const oldRecords = scanTaskRecordsFor(previous).filter(record => record.origin !== "vision"
    || !record.inventoryKeys.length || !record.inventoryKeys.every(identity => refreshed.has(identity) && replacementTaskKeys.has(identity)));
  const taskRecords = mergeScanTaskRecords(oldRecords, newRecords);
  const note = [...new Set([previous.note, reading.note].flatMap(value => String(value || "").split("\n")).map(value => value.trim()).filter(Boolean))].join("\n");
  if (objects.length > 200) throw new RangeError("This room would exceed 200 item groups. Your original room is unchanged; remove incorrect items before rescanning.");
  if (note.length > 1000) throw new RangeError("The combined room instructions exceed 1,000 characters. Your original room is unchanged; shorten its notes before rescanning.");
  return {...previous, ...reading, name:previous.name || previous.roomName, roomType:inferredRoomType(previous),
    note, objects, fixtures:objects.map(inventoryDisplayLabel), taskRecords, tasks:taskRecords.map(record => record.text),
    removedInventoryKeys:[...removed], changedInventoryKeys:[...protectedKeys]};
}

// Structural edits are local and immutable; a failing assessment cannot undo
// them. Object keys survive room moves, except when the destination owns one.
export function editScanRooms(rooms, edit) {
  const list = Array.isArray(rooms) ? rooms : [];
  const index = list.findIndex(room => key(room.name || room.roomName) === key(edit.roomName));
  if (edit.action === "add-room") {
    const name = text(edit.name, 80);
    if (!name || /[:\r\n]/.test(name)) throw new Error("Enter a room name without a colon or line break.");
    if (list.some(room => key(room.name || room.roomName) === key(name))) throw new Error("That room name is already in use.");
    if (list.length >= 20) throw new Error("This scan already has 20 rooms.");
    return [...list, { name, roomType: "other", objects: [], fixtures: [], tasks: [], taskRecords: [], note: "" }];
  }
  if (index < 0) throw new Error("That room is no longer in the scan.");
  const room = list[index], objects = room.objects || [];
  const next = [...list];
  if (edit.action === "rename-room") {
    const name = text(edit.name, 80);
    if (!name || /[:\r\n]/.test(name)) throw new Error("Enter a room name without a colon or line break.");
    if (list.some((entry, i) => i !== index && key(entry.name || entry.roomName) === key(name))) throw new Error("Choose a distinct room name.");
    const previousName = String(room.name || room.roomName);
    const renamePrefix = value => String(value).toLowerCase().startsWith(previousName.toLowerCase() + ":") ? name + String(value).slice(previousName.length) : value;
    next[index] = { ...room, name, roomName: name, roomType: inferredRoomType(room),
      tasks: (room.tasks || []).map(renamePrefix), taskRecords: scanTaskRecordsFor(room).map(record => ({ ...record, text: renamePrefix(record.text) })) };
  } else if (edit.action === "room-type") {
    if (!scanRoomTypes.includes(edit.value)) throw new Error("Choose a room type.");
    next[index] = { ...room, roomType: edit.value };
  } else if (edit.action === "remove-room") {
    return list.filter((_, i) => i !== index);
  } else if (edit.action === "add-item") {
    const label = text(edit.label, 40);
    if (!label) throw new Error("Enter an item name.");
    if (objects.length >= 200) throw new Error("This room already has 200 item groups.");
    const base = inventoryKey(label);
    let identity = base, suffix = 2;
    while (objects.some(item => item.inventoryKey === identity) || (room.removedInventoryKeys || []).includes(identity)) identity = `${base}-${suffix++}`;
    const object = { inventoryKey: identity, pricingCode: base, label, quantity: 1, condition: "", soiling: [], confidenceLabel: 1,
      confidenceCondition: 0, conditionConfirmed: false, origin: "manual", evidence: "" };
    const task = `Clean the ${label.toLowerCase()}`;
    next[index] = { ...changed(room, [...objects, object], [], [identity]),
      tasks: [...(room.tasks || []), task],
      taskRecords: [...scanTaskRecordsFor(room), { text: task, origin: "vision", inventoryKeys: [identity] }] };
  } else if (edit.action === "move-item") {
    const destination = list.findIndex(entry => key(entry.name || entry.roomName) === key(edit.destination));
    const object = objects.find(entry => entry.inventoryKey === edit.inventoryKey);
    if (!object || destination < 0) throw new Error("Choose an item and its destination room.");
    if (destination === index) return list;
    const target = list[destination], targetObjects = target.objects || [];
    if (targetObjects.length >= 200) throw new Error("The destination room is full.");
    let identity = object.inventoryKey, suffix = 2;
    while (targetObjects.some(entry => entry.inventoryKey === identity) || (target.removedInventoryKeys || []).includes(identity)) identity = `${object.inventoryKey}-${suffix++}`;
    next[index] = changed(room, objects.filter(entry => entry !== object), [object.inventoryKey]);
    const sourceName = room.name || room.roomName, targetName = target.name || target.roomName;
    // Move only tasks linked solely to this item. A grouped instruction stays
    // in the original room with its existing review warning; customer notes
    // never change rooms merely because one detected object moves.
    const movedTasks = scanTaskRecordsFor(room)
      .filter(record => record.origin === "vision" && record.inventoryKeys.length === 1 && record.inventoryKeys[0] === object.inventoryKey)
      .map(record => ({ ...record,
        text: record.text.toLowerCase().startsWith(String(sourceName).toLowerCase() + ":")
          ? targetName + record.text.slice(sourceName.length) : record.text,
        inventoryKeys: [identity] }));
    if (!movedTasks.length) movedTasks.push({text: `Clean the ${inventoryDisplayLabel(object).toLowerCase()}`, origin: "vision", inventoryKeys: [identity]});
    next[destination] = { ...changed(target, [...targetObjects, { ...object, inventoryKey: identity, pricingCode: object.pricingCode || inventoryKey(object.label) }], [], [identity]),
      tasks: [...(target.tasks || []), ...movedTasks.map(record => record.text)],
      taskRecords: [...scanTaskRecordsFor(target), ...movedTasks] };
  } else throw new Error("That scan edit is unavailable.");
  return next;
}
