export const wholePropertyLabel = "Whole property";

export function isChecklistExclusion(value) {
  return /^(?:do\s+not|don't|dont|no\s+need|not\s+(?:necessary|required)|skip|exclude|avoid|leave)\b/i.test(String(value || "").trim());
}

export function splitChecklistTask(value, roomOptions = []) {
  const task = String(value || "").trim();
  const rooms = [...new Set(Array.isArray(roomOptions) ? roomOptions.map((room) => String(room || "").trim()).filter(Boolean) : [])]
    .sort((left, right) => right.length - left.length);
  const room = rooms.find((candidate) => task.toLowerCase().startsWith(`${candidate.toLowerCase()}:`)) || "";
  const instruction = room ? task.slice(room.length + 1).trim() : task;
  return { room: room || wholePropertyLabel, instruction, exclusion: isChecklistExclusion(instruction) };
}

export function cleanerHandoffPreview({ tasks = [], photographedAreas = [], roomOptions = [] } = {}) {
  const safeTasks = Array.isArray(tasks) ? tasks : [];
  const validRooms = new Set(Array.isArray(roomOptions) ? roomOptions : []);
  const shownRooms = [...new Set((Array.isArray(photographedAreas) ? photographedAreas : []).map((area) => String(area || "").trim()).filter((area) => validRooms.has(area)))];
  const groupOrder = [...shownRooms];
  const grouped = new Map(groupOrder.map((room) => [room, { room, work: [], exclusions: [], photographed: true }]));

  for (const value of safeTasks) {
    const parsed = splitChecklistTask(value, roomOptions);
    if (!parsed.instruction) continue;
    if (!grouped.has(parsed.room)) {
      grouped.set(parsed.room, { room: parsed.room, work: [], exclusions: [], photographed: shownRooms.includes(parsed.room) });
      groupOrder.push(parsed.room);
    }
    grouped.get(parsed.room)[parsed.exclusion ? "exclusions" : "work"].push(parsed.instruction);
  }

  const groups = groupOrder.map((room) => grouped.get(room));
  const missingWorkAreas = shownRooms.filter((room) => (grouped.get(room)?.work.length || 0) === 0);
  return {
    groups,
    workCount: groups.reduce((total, group) => total + group.work.length, 0),
    exclusionCount: groups.reduce((total, group) => total + group.exclusions.length, 0),
    missingWorkAreas
  };
}

