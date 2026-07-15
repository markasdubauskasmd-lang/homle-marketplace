import { buildRoomScanFollowupDraft } from "../request-followup-draft.mjs";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const request = {
  id: "REQ-TEST1234",
  contactName: "Test Customer",
  email: "customer@example.com",
  service: "Rental turnover clean",
  customerStatusToken: "PRIVATE_TRACKER_TOKEN_MUST_NOT_LEAK"
};

const blocked = buildRoomScanFollowupDraft({ request, verifiedPublicOrigin: "" });
const blockedSerialised = JSON.stringify(blocked);
assert(blocked.allowed && !blocked.handoffReady && blocked.privateUrl === "", "An unverified deployment produced a customer-ready follow-up.");
assert(!blockedSerialised.includes(request.customerStatusToken) && !blockedSerialised.includes("localhost") && !blockedSerialised.includes("127.0.0.1"), "A blocked follow-up leaked its private token or a local origin.");
assert(blocked.sendsAutomatically === false && blocked.requiresFounderOutreachApproval === true, "The draft lost its no-send or explicit-approval boundary.");

const ready = buildRoomScanFollowupDraft({ request, verifiedPublicOrigin: "https://tideway.example.org" });
assert(ready.handoffReady && ready.privateUrl === `https://tideway.example.org/request-status#${request.customerStatusToken}`, "A verified deployment did not produce the exact private tracker handoff.");
assert(ready.recipient.email === request.email && !Object.hasOwn(ready.recipient, "phone"), "The room-scan draft exposed more recipient data than required.");

const revision = buildRoomScanFollowupDraft({
  request,
  latestBrief: { status: "needs-revision", reviewNote: "INTERNAL NOTE MUST STAY PRIVATE" },
  verifiedPublicOrigin: "https://tideway.example.org"
});
assert(revision.kind === "room-scan-revision" && revision.handoffReady, "A revision request did not produce the correct follow-up state.");
assert(!JSON.stringify(revision).includes("INTERNAL NOTE MUST STAY PRIVATE"), "An internal scan-review note leaked into the customer draft.");

for (const status of ["landlord-draft", "reviewed"]) {
  const noDuplicate = buildRoomScanFollowupDraft({ request, latestBrief: { status }, verifiedPublicOrigin: "https://tideway.example.org" });
  assert(!noDuplicate.allowed && noDuplicate.statusCode === 409, `A ${status} scan incorrectly allowed another scan follow-up.`);
}

for (const requestStatus of ["booked", "completed", "lost"]) {
  const closed = buildRoomScanFollowupDraft({ request, requestStatus, verifiedPublicOrigin: "https://tideway.example.org" });
  assert(!closed.allowed && closed.statusCode === 409 && !JSON.stringify(closed).includes(request.customerStatusToken), `A ${requestStatus} request exposed an active follow-up.`);
}

console.log("Room-scan follow-up draft tests passed: verified-origin handoff, no-send boundary, stage gating and private-note isolation.");
