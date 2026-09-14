import { inventoryKey, inventoryDisplayLabel, scanTaskRecordsFor } from "./room-scan-model.js";

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
    if (!name) throw new Error("Enter a room name.");
    if (list.some((entry, i) => i !== index && key(entry.name || entry.roomName) === key(name))) throw new Error("Choose a distinct room name.");
    const renamePrefix = value => String(value).startsWith(room.name + ":") ? name + String(value).slice(room.name.length) : value;
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
    while (objects.some(item => item.inventoryKey === identity)) identity = `${base}-${suffix++}`;
    const object = { inventoryKey: identity, label, quantity: 1, condition: "", soiling: [], confidenceLabel: 1,
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
    if (targetObjects.length >= 100) throw new Error("The destination room is full.");
    let identity = object.inventoryKey, suffix = 2;
    while (targetObjects.some(entry => entry.inventoryKey === identity)) identity = `${object.inventoryKey}-${suffix++}`;
    next[index] = changed(room, objects.filter(entry => entry !== object), [object.inventoryKey]);
    const task = `Clean the ${object.label.toLowerCase()}`;
    next[destination] = { ...changed(target, [...targetObjects, { ...object, inventoryKey: identity }], [], [identity]),
      tasks: [...(target.tasks || []), task],
      taskRecords: [...scanTaskRecordsFor(target), { text: task, origin: "vision", inventoryKeys: [identity] }] };
  } else throw new Error("That scan edit is unavailable.");
  return next;
}
