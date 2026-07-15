function mapProgressError(error) {
  const errors = {
    "booking-not-found": [404, "booking-not-found", "The booking was not found."],
    "task-not-found": [404, "task-not-found", "The cleaning task was not found."],
    "cleaning-not-startable": [409, "cleaning-not-startable", "Cleaning can start only after the Cleaner has arrived."],
    "cleaning-outside-safe-window": [409, "cleaning-outside-safe-window", "Cleaning is outside the safe booking window."],
    "cleaning-not-active": [409, "cleaning-not-active", "Cleaning must be active and resumed before this update."],
    "invalid-pause": [422, "invalid-pause", "Pausing requires a reason and a valid pause state."],
    "invalid-task-update": [422, "invalid-task-update", "The cleaning-task update is invalid."],
    "unexpected-task-not-approved": [409, "unexpected-task-not-approved", "The Landlord must approve this unexpected task first."],
    "invalid-unexpected-task": [422, "invalid-unexpected-task", "The unexpected task is invalid."],
    "invalid-task-decision": [422, "invalid-task-decision", "The unexpected-task decision is invalid."],
    "task-decision-final": [409, "task-decision-final", "This unexpected-task decision is already final."],
    "cleaning-not-finishable": [409, "cleaning-not-finishable", "Resume active cleaning before finishing the job."],
    "cleaning-tasks-unresolved": [409, "cleaning-tasks-unresolved", "Resolve every checklist task and unexpected-task decision before finishing."]
  };
  const selected = errors[error?.message];
  return selected ? Object.assign(new Error(selected[2]), { statusCode: selected[0], code: selected[1], cause: error }) : error;
}

export function createProgressRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  async function call(actor, text, values) {
    return database.withUserTransaction(actor, async (client) => {
      try { return (await client.query(text, values)).rows[0]?.snapshot; }
      catch (error) { throw mapProgressError(error); }
    });
  }
  return Object.freeze({
    getProgress(actor, bookingId) { return call(actor, "SELECT tideway_private.get_cleaning_progress($1::uuid) AS snapshot", [bookingId]); },
    startCleaning(actor, bookingId) { return call(actor, "SELECT tideway_private.start_booking_cleaning($1::uuid) AS snapshot", [bookingId]); },
    setPause(actor, bookingId, input) { return call(actor, "SELECT tideway_private.set_booking_cleaning_pause($1::uuid,$2::boolean,$3::text) AS snapshot", [bookingId, input.paused, input.note]); },
    updateTask(actor, bookingId, taskId, input) { return call(actor, "SELECT tideway_private.update_booking_cleaning_task($1::uuid,$2::uuid,$3::text,$4::text) AS snapshot", [bookingId, taskId, input.status, input.note]); },
    addUnexpectedTask(actor, bookingId, input) { return call(actor, "SELECT tideway_private.add_unexpected_cleaning_task($1::uuid,$2::text,$3::text,$4::integer,$5::text) AS snapshot", [bookingId, input.roomName, input.description, input.estimatedAdditionalMinutes, input.note]); },
    decideUnexpectedTask(actor, bookingId, taskId, input) { return call(actor, "SELECT tideway_private.decide_unexpected_cleaning_task($1::uuid,$2::uuid,$3::text,$4::boolean,$5::text) AS snapshot", [bookingId, taskId, input.decision, input.priceUnchangedConfirmed, input.note]); },
    finishCleaning(actor, bookingId) { return call(actor, "SELECT tideway_private.finish_booking_cleaning($1::uuid) AS snapshot", [bookingId]); }
  });
}
