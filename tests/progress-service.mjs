import { readFile } from "node:fs/promises";
import { createProgressRepository } from "../src/marketplace/progress-repository.mjs";
import { createProgressService } from "../src/marketplace/progress-service.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function rejects(operation, fragment) { try { await operation(); } catch (error) { return String(error.message).includes(fragment); } return false; }

const bookingId = "55555555-5555-4555-8555-555555555555";
const taskId = "77777777-7777-4777-8777-777777777777";
const cleaner = { userId: "22222222-2222-4222-8222-222222222222", roles: ["cleaner"] };
const landlord = { userId: "11111111-1111-4111-8111-111111111111", roles: ["landlord"] };
function progress(overrides = {}) {
  return {
    bookingId,
    status: "cleaning-in-progress",
    scheduledStartAt: "2026-07-20T09:00:00.000Z",
    cleaningStartedAt: "2026-07-20T09:02:00.000Z",
    cleaningFinishedAt: null,
    isPaused: false,
    elapsedSeconds: 900,
    totalTasks: 2,
    completedTasks: 1,
    resolvedTasks: 1,
    overallPercentage: 50,
    rooms: [{ roomName: "Kitchen", totalTasks: 2, resolvedTasks: 1, completed: false }],
    tasks: [{ taskId, roomName: "Kitchen", description: "Clean worktops", status: "completed", unexpected: false, landlordApprovalStatus: null, latestNote: "Done", updatedAt: "2026-07-20T09:10:00.000Z", updatedBy: cleaner.userId }],
    photos: [{ photoId: "88888888-8888-4888-8888-888888888888", taskId, photoType: "after", note: "Finished", uploadedBy: cleaner.userId, createdAt: "2026-07-20T09:11:00.000Z", storageKey: "private/secret.jpg" }],
    eventVersion: 4,
    recentEvents: [{ eventId: 4, eventType: "task-updated", actorUserId: cleaner.userId, payload: { taskId }, createdAt: "2026-07-20T09:10:00.000Z" }],
    ...overrides
  };
}
const calls = [];
const fakeRepository = {
  async getProgress(actor, id) { calls.push({ kind: "get", actor, id }); return progress(); },
  async startCleaning(actor, id) { calls.push({ kind: "start", actor, id }); return progress(); },
  async setPause(actor, id, input) { calls.push({ kind: "pause", actor, id, input }); return progress({ isPaused: input.paused }); },
  async updateTask(actor, id, suppliedTaskId, input) { calls.push({ kind: "task", actor, id, suppliedTaskId, input }); return progress({ tasks: [{ ...progress().tasks[0], status: input.status, latestNote: input.note }] }); },
  async addUnexpectedTask(actor, id, input) { calls.push({ kind: "add", actor, id, input }); return progress({ totalTasks: 3, tasks: [...progress().tasks, { taskId: "99999999-9999-4999-8999-999999999999", ...input, status: "not-started", unexpected: true, landlordApprovalStatus: "pending", latestNote: input.note, updatedAt: "2026-07-20T09:12:00.000Z", updatedBy: actor.userId }] }); },
  async decideUnexpectedTask(actor, id, suppliedTaskId, input) { calls.push({ kind: "decision", actor, id, suppliedTaskId, input }); return progress(); },
  async finishCleaning(actor, id) { calls.push({ kind: "finish", actor, id }); return progress({ status: "awaiting-review", cleaningFinishedAt: "2026-07-20T11:00:00.000Z", overallPercentage: 100, resolvedTasks: 2 }); }
};
const service = createProgressService(fakeRepository);
const started = await service.startCleaning(cleaner, bookingId);
const paused = await service.setPause(cleaner, bookingId, { paused: true, note: "Waiting for access to the utility cupboard" });
const task = await service.updateTask(cleaner, bookingId, taskId, { status: "issue-reported", note: "Tap appears damaged before cleaning" });
const added = await service.addUnexpectedTask(cleaner, bookingId, { roomName: "Hall", description: "Remove unexpected packaging", estimatedAdditionalMinutes: 20, note: "Approval required" });
await service.decideUnexpectedTask(landlord, bookingId, "99999999-9999-4999-8999-999999999999", { decision: "approved", priceUnchangedConfirmed: true, note: "Please continue" });
const finished = await service.finishCleaning(cleaner, bookingId);
const landlordView = await service.getProgress(landlord, bookingId);
assert(started.status === "cleaning-in-progress" && paused.isPaused && task.tasks[0].status === "issue-reported" && added.tasks.at(-1).landlordApprovalStatus === "pending" && finished.status === "awaiting-review" && landlordView.eventVersion === 4, "Cleaning start, pause, task, unexpected approval, finish or participant projection failed.");
assert(!JSON.stringify(landlordView).includes("private/secret.jpg") && !Object.hasOwn(landlordView.photos[0], "storageKey"), "Cleaning progress exposed a private storage key.");
assert(calls.find((call) => call.kind === "task").input.note === "Tap appears damaged before cleaning" && calls.find((call) => call.kind === "decision").actor.userId === landlord.userId, "Task notes or Landlord decision lost their responsible actor.");
assert(await rejects(() => service.setPause(cleaner, bookingId, { paused: true }), "Pause reason"), "A job paused without a reason.");
assert(await rejects(() => service.updateTask(cleaner, bookingId, taskId, { status: "issue-reported" }), "require a note"), "An issue was reported without evidence notes.");
assert(await rejects(() => service.decideUnexpectedTask(cleaner, bookingId, taskId, { decision: "approved" }), "Landlord"), "A Cleaner approved their own unexpected task.");
assert(await rejects(() => service.decideUnexpectedTask(landlord, bookingId, taskId, { decision: "approved" }), "frozen booking price"), "A Landlord approved added work without confirming unchanged frozen economics.");
assert(await rejects(() => service.finishCleaning(landlord, bookingId), "Cleaner"), "A Landlord marked Cleaner work finished.");

const databaseCalls = [];
let failure = null;
const database = { async withUserTransaction(actor, operation) { return operation({ async query(text, values) { databaseCalls.push({ actor, text, values }); if (failure) throw failure; return { rows: [{ snapshot: progress() }] }; } }); } };
const repository = createProgressRepository(database);
await repository.getProgress(landlord, bookingId);
await repository.startCleaning(cleaner, bookingId);
await repository.setPause(cleaner, bookingId, { paused: true, note: "Break" });
await repository.updateTask(cleaner, bookingId, taskId, { status: "completed", note: null });
await repository.addUnexpectedTask(cleaner, bookingId, { roomName: "Hall", description: "Clear packaging", estimatedAdditionalMinutes: 15, note: null });
await repository.decideUnexpectedTask(landlord, bookingId, taskId, { decision: "declined", priceUnchangedConfirmed: false, note: "Outside scope" });
await repository.finishCleaning(cleaner, bookingId);
for (const name of ["get_cleaning_progress", "start_booking_cleaning", "set_booking_cleaning_pause", "update_booking_cleaning_task", "add_unexpected_cleaning_task", "decide_unexpected_cleaning_task", "finish_booking_cleaning"]) assert(databaseCalls.some((call) => call.text.includes(name)), `Progress repository did not call ${name}.`);
assert(databaseCalls.every((call) => call.text.includes("$1::uuid")), "Progress repository used an unparameterized booking identifier.");
failure = new Error("cleaning-tasks-unresolved");
assert(await rejects(() => repository.finishCleaning(cleaner, bookingId), "Resolve every checklist"), "Unresolved tasks did not safely block finishing.");

const migration = await readFile(new URL("../db/migrations/013_live_cleaning_progress.sql", import.meta.url), "utf8");
const grants = await readFile(new URL("../db/runtime-role-grants.sql", import.meta.url), "utf8");
for (const required of ["job_pauses_one_open_per_booking_idx", "unexpected_task_decisions", "price_unchanged_confirmed", "unexpected_estimated_minutes", "booking_progress_events", "booking_progress_events_participants", "elapsedSeconds", "overallPercentage", "recentEvents", "cleaning-started", "issue-reported", "unexpected-task-added", "unexpected-task-approved", "unexpected-task-declined", "cleaning-tasks-unresolved", "review-requested", "actor_user_id", "created_at"]) assert(migration.includes(required), `Cleaning progress migration omitted ${required}.`);
assert(grants.includes("finish_booking_cleaning") && grants.includes("REVOKE INSERT, UPDATE, DELETE ON bookings") && ["booking_progress_events", "job_photos", "cleaner_locations", "notifications"].every((table) => grants.includes(table)), "The web role can bypass audited progress/photo/notification functions.");

console.log("Progress tests passed: role-bound start/pause/task/issue/unexpected approval/finish, resolved-task gate, elapsed and room progress, durable actor events, safe photo metadata and participant-only projections.");
