function taskKey(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function uniqueTasks(values) {
  const tasks = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const task = String(value || "").trim().replace(/\s+/g, " ");
    const key = taskKey(task);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    tasks.push(task);
  }
  return tasks;
}

export function checklistChangeReview(currentTasks = [], nextTasks = []) {
  const current = uniqueTasks(currentTasks);
  const next = uniqueTasks(nextTasks);
  const currentKeys = current.map(taskKey);
  const nextKeys = next.map(taskKey);
  const currentSet = new Set(currentKeys);
  const nextSet = new Set(nextKeys);
  const added = next.filter((task) => !currentSet.has(taskKey(task)));
  const removed = current.filter((task) => !nextSet.has(taskKey(task)));
  const orderChanged = added.length === 0 && removed.length === 0 && currentKeys.join("\n") !== nextKeys.join("\n");
  return {
    current,
    next,
    added,
    removed,
    orderChanged,
    changed: added.length > 0 || removed.length > 0 || orderChanged,
    unchangedCount: next.filter((task) => currentSet.has(taskKey(task))).length
  };
}

