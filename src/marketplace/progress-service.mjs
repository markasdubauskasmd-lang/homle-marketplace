const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const taskStatuses = Object.freeze(["not-started", "in-progress", "completed", "skipped", "issue-reported"]);

function uuid(value, label) {
  if (!uuidPattern.test(value || "")) throw new TypeError(`A valid ${label} is required.`);
  return value.toLowerCase();
}

function text(value, maximum, label, minimum = 0) {
  const normalized = typeof value === "string" ? value.trim().replace(/[\u0000-\u001f\u007f]/g, "") : "";
  if (normalized.length < minimum || normalized.length > maximum) throw new TypeError(`${label} must contain ${minimum} to ${maximum} characters.`);
  return normalized;
}

function integer(value, minimum, maximum, label) {
  const normalized = Number(value);
  if (!Number.isInteger(normalized) || normalized < minimum || normalized > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return normalized;
}

function list(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function projection(value) {
  const record = typeof value === "string" ? JSON.parse(value) : value;
  if (!record || typeof record !== "object") throw new Error("Cleaning progress is unavailable.");
  return {
    bookingId: record.bookingId,
    status: record.status,
    scheduledStartAt: record.scheduledStartAt,
    cleaningStartedAt: record.cleaningStartedAt || null,
    cleaningFinishedAt: record.cleaningFinishedAt || null,
    isPaused: record.isPaused === true,
    elapsedSeconds: Number(record.elapsedSeconds) || 0,
    totalTasks: Number(record.totalTasks) || 0,
    completedTasks: Number(record.completedTasks) || 0,
    resolvedTasks: Number(record.resolvedTasks) || 0,
    overallPercentage: Number(record.overallPercentage) || 0,
    rooms: list(record.rooms).map((room) => ({ roomName: room.roomName, totalTasks: Number(room.totalTasks), resolvedTasks: Number(room.resolvedTasks), completed: room.completed === true })),
    tasks: list(record.tasks).map((task) => ({ taskId: task.taskId, roomName: task.roomName, description: task.description, status: task.status, unexpected: task.unexpected === true, unexpectedEstimatedMinutes: task.unexpectedEstimatedMinutes == null ? null : Number(task.unexpectedEstimatedMinutes), landlordApprovalStatus: task.landlordApprovalStatus || null, latestNote: task.latestNote || null, updatedAt: task.updatedAt, updatedBy: task.updatedBy || null })),
    photos: list(record.photos).map((photo) => ({ photoId: photo.photoId, taskId: photo.taskId || null, photoType: photo.photoType, note: photo.note || null, uploadedBy: photo.uploadedBy, createdAt: photo.createdAt })),
    eventVersion: Number(record.eventVersion) || 0,
    recentEvents: list(record.recentEvents).map((event) => ({ eventId: Number(event.eventId), eventType: event.eventType, actorUserId: event.actorUserId, payload: event.payload || {}, createdAt: event.createdAt }))
  };
}

export function createProgressService(repository) {
  const methods = ["getProgress", "startCleaning", "setPause", "updateTask", "addUnexpectedTask", "decideUnexpectedTask", "finishCleaning"];
  if (!repository || !methods.every((method) => typeof repository[method] === "function")) throw new TypeError("A complete cleaning-progress repository is required.");
  function cleaner(actor, action) {
    if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("cleaner")) throw new TypeError(`A Cleaner account is required to ${action}.`);
  }
  return Object.freeze({
    async getProgress(actor, bookingId) {
      if (!actor?.userId) throw new TypeError("An authenticated booking participant is required to view cleaning progress.");
      return projection(await repository.getProgress(actor, uuid(bookingId, "booking id")));
    },
    async startCleaning(actor, bookingId) {
      cleaner(actor, "start cleaning");
      return projection(await repository.startCleaning(actor, uuid(bookingId, "booking id")));
    },
    async setPause(actor, bookingId, input = {}) {
      cleaner(actor, "pause or resume cleaning");
      if (typeof input.paused !== "boolean") throw new TypeError("Paused must be true or false.");
      const note = text(input.note, 1000, input.paused ? "Pause reason" : "Resume note", input.paused ? 1 : 0) || null;
      return projection(await repository.setPause(actor, uuid(bookingId, "booking id"), { paused: input.paused, note }));
    },
    async updateTask(actor, bookingId, taskId, input = {}) {
      cleaner(actor, "update a cleaning task");
      const status = text(input.status, 30, "Task status", 1);
      if (!taskStatuses.includes(status)) throw new TypeError("Choose a supported cleaning-task status.");
      const note = text(input.note, 2000, "Task note") || null;
      if ((status === "skipped" || status === "issue-reported") && !note) throw new TypeError("Skipped tasks and reported issues require a note.");
      return projection(await repository.updateTask(actor, uuid(bookingId, "booking id"), uuid(taskId, "task id"), { status, note }));
    },
    async addUnexpectedTask(actor, bookingId, input = {}) {
      cleaner(actor, "add an unexpected task");
      return projection(await repository.addUnexpectedTask(actor, uuid(bookingId, "booking id"), {
        roomName: text(input.roomName, 120, "Room name", 1),
        description: text(input.description, 1000, "Task description", 1),
        estimatedAdditionalMinutes: integer(input.estimatedAdditionalMinutes, 1, 480, "Estimated additional time"),
        note: text(input.note, 2000, "Task note") || null
      }));
    },
    async decideUnexpectedTask(actor, bookingId, taskId, input = {}) {
      if (!actor?.userId || !Array.isArray(actor.roles) || !actor.roles.includes("landlord")) throw new TypeError("A Landlord account is required to decide an unexpected task.");
      const decision = text(input.decision, 20, "Task decision", 1).toLowerCase();
      if (decision !== "approved" && decision !== "declined") throw new TypeError("Choose approved or declined.");
      if (decision === "approved" && input.priceUnchangedConfirmed !== true) throw new TypeError("Confirm that approving this task does not change the frozen booking price or Cleaner pay.");
      const note = text(input.note, 1000, "Decision note") || null;
      return projection(await repository.decideUnexpectedTask(actor, uuid(bookingId, "booking id"), uuid(taskId, "task id"), { decision, priceUnchangedConfirmed: input.priceUnchangedConfirmed === true, note }));
    },
    async finishCleaning(actor, bookingId) {
      cleaner(actor, "finish cleaning");
      return projection(await repository.finishCleaning(actor, uuid(bookingId, "booking id")));
    }
  });
}

export { taskStatuses };
