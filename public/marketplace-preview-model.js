const sampleTasks = Object.freeze([
  Object.freeze({ id: "kitchen", room: "Kitchen", task: "Clean worktops and sink" }),
  Object.freeze({ id: "bathroom", room: "Bathroom", task: "Clean basin, toilet and shower" }),
  Object.freeze({ id: "main-bedroom", room: "Main bedroom", task: "Dust surfaces and vacuum floor" }),
  Object.freeze({ id: "living-room", room: "Living room", task: "Dust surfaces and vacuum floor" })
]);

const supportedStates = new Set(["en-route", "arrived", "cleaning", "finished"]);

export function marketplaceTaskPreview(input = {}) {
  const state = supportedStates.has(input.state) ? input.state : "en-route";
  const role = input.role === "cleaner" ? "cleaner" : "landlord";
  const knownIds = new Set(sampleTasks.map((task) => task.id));
  const completed = new Set((Array.isArray(input.completedTaskIds) ? input.completedTaskIds : []).filter((id) => knownIds.has(id)));
  const issues = new Set((Array.isArray(input.issueTaskIds) ? input.issueTaskIds : []).filter((id) => knownIds.has(id)));
  const cleaningStarted = state === "cleaning" || state === "finished";
  if (!cleaningStarted) {
    completed.clear();
    issues.clear();
  }
  if (state === "finished") {
    for (const task of sampleTasks) completed.add(task.id);
    issues.clear();
  }
  for (const id of issues) completed.delete(id);
  const canUpdate = role === "cleaner" && state === "cleaning";
  const firstPendingId = sampleTasks.find((task) => !completed.has(task.id) && !issues.has(task.id))?.id || "";
  const tasks = sampleTasks.map((task, index) => {
    const issue = issues.has(task.id);
    const complete = completed.has(task.id);
    const current = state === "cleaning" && !issue && !complete && task.id === firstPendingId;
    return Object.freeze({
      ...task,
      marker: complete ? "✓" : issue ? "!" : String(index + 1),
      status: complete ? "complete" : issue ? "issue" : current ? "current" : "pending",
      statusLabel: complete ? "Completed in this preview" : issue ? "Sample issue reported" : current ? "Ready to clean" : cleaningStarted ? "Not started" : "Waiting for cleaning to start",
      actionLabel: complete ? "Mark not started" : "Mark complete",
      actionAllowed: canUpdate
    });
  });
  const completedCount = tasks.filter((task) => task.status === "complete").length;
  const issueCount = tasks.filter((task) => task.status === "issue").length;
  const percent = Math.round((completedCount / tasks.length) * 100);
  const progressCopy = !cleaningStarted
    ? "Cleaning has not started"
    : issueCount
      ? `${completedCount} of ${tasks.length} sample tasks complete · ${issueCount} issue ${issueCount === 1 ? "needs" : "need"} attention`
      : `${completedCount} of ${tasks.length} sample tasks complete`;

  return Object.freeze({
    state,
    role,
    tasks: Object.freeze(tasks),
    completedCount,
    issueCount,
    total: tasks.length,
    percent,
    progressCopy,
    canUpdate,
    canReportIssue: canUpdate,
    canFinish: state === "cleaning" && completedCount === tasks.length && issueCount === 0
  });
}

export { sampleTasks };
