const closedRequestStatuses = new Set(["booked", "completed", "lost"]);

function boundedText(value, maximum = 300) {
  return String(value || "").trim().slice(0, maximum);
}

function followupKind(latestBrief) {
  if (!latestBrief) return "room-scan-required";
  if (latestBrief.status === "needs-revision") return "room-scan-revision";
  return "";
}

export function buildRoomScanFollowupDraft({ request, requestStatus = "new", latestBrief = null, booking = null, verifiedPublicOrigin = "" } = {}) {
  if (!request?.id) return { allowed: false, statusCode: 404, error: "Customer request not found." };
  if (booking || closedRequestStatuses.has(requestStatus)) {
    return { allowed: false, statusCode: 409, error: "This request is no longer awaiting a pre-booking room scan." };
  }

  const kind = followupKind(latestBrief);
  if (!kind) {
    return {
      allowed: false,
      statusCode: 409,
      error: latestBrief?.status === "landlord-draft"
        ? "The room scan is already submitted and awaiting Tideway review."
        : "The room scan is already reviewed; continue with matching instead of requesting another scan."
    };
  }

  const contactName = boundedText(request.contactName, 120) || "there";
  const service = boundedText(request.service, 160) || "your requested clean";
  const reference = boundedText(request.id, 40);
  const token = boundedText(request.customerStatusToken, 120);
  const origin = boundedText(verifiedPublicOrigin, 300).replace(/\/$/, "");
  const handoffReady = Boolean(origin && token);
  const privateUrl = handoffReady ? `${origin}/request-status#${token}` : "";
  const revision = kind === "room-scan-revision";
  const subject = revision
    ? `Action needed: revise your Tideway room scan · ${reference}`
    : `Complete your private Tideway room scan · ${reference}`;
  const body = [
    `Hello ${contactName},`,
    "",
    revision
      ? `Your room scan for ${service.toLowerCase()} needs a correction before Tideway can assess the scope.`
      : `To assess the scope for ${service.toLowerCase()}, Tideway still needs your private room scan.`,
    "",
    "Open your private request tracker, then:",
    "- add a clear photo or short video for each room that needs cleaning",
    "- speak or type what the Cleaner needs to do in each room",
    "- review the concise room-by-room checklist before submitting",
    "",
    revision
      ? "The tracker will let you submit a replacement scan. Tideway's internal review note is not included in this draft; confirm the customer-facing correction before outreach."
      : "Submitting the scan does not confirm a Cleaner, price or booking. Tideway will review the scope first.",
    "",
    "Keep the private tracker link confidential."
  ].join("\n");

  const warnings = [];
  if (!verifiedPublicOrigin) warnings.push("Add and verify the deployed public HTTPS website before preparing a customer-ready private link.");
  if (!token) warnings.push("This request has no valid private tracker token; do not create or guess a link.");
  if (revision) warnings.push("The internal scan-review note is deliberately excluded. Confirm the customer-facing correction before any authorised outreach.");

  return {
    allowed: true,
    kind,
    handoffReady,
    warnings,
    recipient: { email: boundedText(request.email, 254) },
    subject,
    body,
    privateUrl,
    requiresFounderOutreachApproval: true,
    sendsAutomatically: false
  };
}

