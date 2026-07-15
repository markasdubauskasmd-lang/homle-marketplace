(function attachScanReviewWorkspace(globalObject) {
  function latestBrief(record) {
    return Array.isArray(record?.briefs) && record.briefs.length ? record.briefs[0] : null;
  }

  function scanReviewSummary(records = []) {
    const briefs = records
      .filter((record) => record?.kind === "request")
      .map((record) => latestBrief(record))
      .filter(Boolean);
    const awaiting = briefs.filter((brief) => brief.status === "landlord-draft").length;
    const reviewed = briefs.filter((brief) => brief.status === "reviewed" && brief.reviewEvidenceConfirmed === true).length;
    const revisionRequested = briefs.filter((brief) => brief.status === "needs-revision").length;
    return { submitted: briefs.length, awaiting, reviewed, revisionRequested };
  }

  function nextScanRecord(records = []) {
    return records
      .filter((record) => record?.kind === "request" && latestBrief(record)?.status === "landlord-draft")
      .sort((left, right) => {
        const leftBrief = latestBrief(left);
        const rightBrief = latestBrief(right);
        return String(leftBrief.createdAt || left.createdAt || "").localeCompare(String(rightBrief.createdAt || right.createdAt || ""));
      })[0] || null;
  }

  function scanReviewReadiness(input = {}) {
    const approving = input.decision === "reviewed";
    const noteComplete = String(input.note || "").trim().length >= 10;
    if (!approving) {
      const steps = [{ key: "revision-note", label: "Clear revision note recorded", complete: noteComplete }];
      return { approving: false, completed: steps.filter((step) => step.complete).length, total: steps.length, ready: noteComplete, steps };
    }

    const hours = Number(input.hours);
    const visualIds = [...new Set((input.visualIds || []).filter(Boolean))];
    const reviewedVisualIds = new Set((input.reviewedVisualIds || []).filter(Boolean));
    const scopeSignalCodes = [...new Set((input.scopeSignalCodes || []).filter(Boolean))];
    const confirmedScopeSignalCodes = new Set((input.confirmedScopeSignalCodes || []).filter(Boolean));
    const everyVisualConfirmed = visualIds.length > 0 && visualIds.every((id) => reviewedVisualIds.has(id));
    const everySignalConfirmed = scopeSignalCodes.every((code) => confirmedScopeSignalCodes.has(code));
    const steps = [
      { key: "customer-scope", label: "Customer confirmed the complete checklist", complete: input.customerScopeConfirmed === true },
      { key: "private-media", label: "Every private visual and room note reviewed", complete: input.visualsReviewed === true && everyVisualConfirmed },
      { key: "checklist", label: "Checklist reconciled with spoken and room notes", complete: input.checklistReviewed === true },
      { key: "price-sensitive", label: scopeSignalCodes.length ? "Every price-sensitive item included in the hours" : "No price-sensitive items require confirmation", complete: everySignalConfirmed },
      { key: "time-breakdown", label: "Room-by-room minutes produce the reviewed total", complete: input.timeBreakdownValid === true },
      { key: "hours", label: "Cleaning-time estimate is between 0.5 and 16 hours", complete: Number.isFinite(hours) && hours >= 0.5 && hours <= 16 },
      { key: "confidence", label: "Scope confidence is medium or high", complete: ["medium", "high"].includes(input.confidence) },
      { key: "evidence-note", label: "Evidence note explains the estimate", complete: noteComplete }
    ];
    const completed = steps.filter((step) => step.complete).length;
    return { approving: true, completed, total: steps.length, ready: completed === steps.length, steps };
  }

  globalObject.TidewayScanReviewWorkspace = Object.freeze({ scanReviewSummary, nextScanRecord, scanReviewReadiness });
})(globalThis);
