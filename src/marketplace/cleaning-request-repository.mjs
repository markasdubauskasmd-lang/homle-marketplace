export function createCleaningRequestRepository(database) {
  if (!database || typeof database.withUserTransaction !== "function") throw new TypeError("The marketplace database boundary is required.");
  return {
    createOwnRequest(actor, request) {
      return database.withUserTransaction(actor, async (client) => {
        const ownedProperty = await client.query("SELECT id FROM properties WHERE id=$1::uuid AND landlord_user_id=$2::uuid AND archived_at IS NULL FOR SHARE", [request.propertyId, actor.userId]);
        if (!ownedProperty.rows[0]) throw Object.assign(new Error("Property was not found."), { statusCode: 404 });
        const inserted = await client.query(
          "INSERT INTO cleaning_requests (id, landlord_user_id, property_id, status, requested_start_at, requested_end_at, cleaning_type, required_services, special_instructions, budget_pence, recurrence_rule, scope_fingerprint, submitted_at) VALUES ($1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz, $6::timestamptz, $7::text, $8::text[], $9::text, $10::integer, $11::text, $12::character(64), $13::timestamptz) RETURNING *",
          [request.id, actor.userId, request.propertyId, request.status, request.requestedStartAt, request.requestedEndAt, request.cleaningType, request.requiredServices, request.specialInstructions, request.budgetPence, request.recurrenceRule, request.scopeFingerprint, request.submittedAt]
        );
        await client.query(
          "INSERT INTO cleaning_request_tasks (cleaning_request_id, room_name, description, sort_order) SELECT $1::uuid, room_name, description, sort_order FROM unnest($2::text[], $3::text[], $4::integer[]) AS supplied(room_name, description, sort_order)",
          [request.id, request.tasks.map((task) => task.roomName), request.tasks.map((task) => task.description), request.tasks.map((task) => task.sortOrder)]
        );
        await client.query(
          "INSERT INTO cleaning_request_status_history (cleaning_request_id, from_status, to_status, changed_by, reason, metadata) VALUES ($1::uuid, NULL, $2::text, $3::uuid, $4::text, $5::jsonb)",
          [request.id, request.status, actor.userId, request.status === "draft" ? "Landlord saved request draft." : "Landlord submitted request for matching.", { scopeFingerprint: request.scopeFingerprint }]
        );
        return { ...inserted.rows[0], tasks: request.tasks };
      });
    },
    listOwnRequests(actor) {
      return database.withUserTransaction(actor, async (client) => {
        const result = await client.query(
          "SELECT request.*, (SELECT count(*)::integer FROM bookings attempt WHERE attempt.cleaning_request_id=request.id) AS automatic_dispatch_attempt_count, COALESCE(jsonb_agg(jsonb_build_object('roomName', task.room_name, 'description', task.description, 'sortOrder', task.sort_order) ORDER BY task.sort_order) FILTER (WHERE task.id IS NOT NULL), '[]'::jsonb) AS tasks FROM cleaning_requests request LEFT JOIN cleaning_request_tasks task ON task.cleaning_request_id=request.id WHERE request.landlord_user_id=$1::uuid GROUP BY request.id ORDER BY request.created_at DESC LIMIT 100",
          [actor.userId]
        );
        return result.rows;
      });
    },
    submitOwnRequest(actor, requestId, choice) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT tideway_private.submit_cleaning_request($1::uuid,$2::boolean,$3::boolean) AS submission", [requestId, choice.scopeReviewed, choice.cleanerPreviewAuthorized]);
          return result.rows[0]?.submission;
        } catch (error) {
          const mapped = {
            "request-not-found": [404, "request-not-found", "The cleaning-request draft was not found."],
            "request-review-required": [422, "request-review-required", "Review and confirm the room scan before submission."],
            "request-not-submittable": [409, "request-not-submittable", "Only a future private draft can be submitted."],
            "request-scan-incomplete": [409, "request-scan-incomplete", "Finish at least one private room photo and wait for every upload to complete."],
            "request-scan-room-mismatch": [409, "request-scan-room-mismatch", "Every room photo must use a room from the reviewed cleaner checklist."]
          }[error?.message];
          if (!mapped) throw error;
          throw Object.assign(new Error(mapped[2]), { statusCode: mapped[0], code: mapped[1], cause: error });
        }
      });
    },
    configureAutomaticDispatch(actor, requestId, choice) {
      return database.withUserTransaction(actor, async (client) => {
        try {
          const result = await client.query("SELECT tideway_private.configure_automatic_dispatch($1::uuid,$2::boolean,$3::smallint) AS dispatch", [requestId, choice.enabled, choice.attemptLimit]);
          return result.rows[0]?.dispatch;
        } catch (error) {
          const mapped = {
            "request-not-found": [404, "request-not-found", "The cleaning request was not found."],
            "request-not-dispatch-configurable": [409, "request-not-dispatch-configurable", "Automatic matching can only be changed for an open future request."],
            "invalid-automatic-dispatch-choice": [400, "invalid-automatic-dispatch-choice", "Choose a valid automatic-matching option."]
          }[error?.message];
          if (!mapped) throw error;
          throw Object.assign(new Error(mapped[2]), { statusCode: mapped[0], code: mapped[1], cause: error });
        }
      });
    }
  };
}
