(function attachScanReviewDraft(globalObject) {
  const version = 1;
  const lifetimeMs = 30 * 60 * 1000;
  const keyPrefix = "tidewayScanReviewDraftV1:";

  function cleanText(value, max = 80) {
    return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
  }

  function contextModel(context = {}) {
    const briefId = cleanText(context.briefId, 80).toUpperCase();
    const areas = [...new Set((context.areas || []).map((value) => cleanText(value, 80)).filter(Boolean))];
    const visualIds = [...new Set((context.visualIds || []).map((value) => cleanText(value, 100)).filter(Boolean))];
    const signalCodes = [...new Set((context.signalCodes || []).map((value) => cleanText(value, 100)).filter(Boolean))];
    return { briefId, areas, visualIds, signalCodes };
  }

  function validContext(context) {
    return /^[A-Z0-9-]{4,80}$/.test(context.briefId) && context.areas.length > 0;
  }

  function draftKey(context) {
    return validContext(context) ? `${keyPrefix}${context.briefId}` : "";
  }

  function fingerprint(context) {
    return JSON.stringify(contextModel(context));
  }

  function cleanValues(context, input = {}) {
    const supplied = new Map((input.areaMinutes || []).map((row) => [cleanText(row?.area, 80).toLowerCase(), String(row?.minutes ?? "").slice(0, 4)]));
    return {
      decision: ["reviewed", "needs-revision"].includes(input.decision) ? input.decision : "reviewed",
      areaMinutes: context.areas.map((area) => ({ area, minutes: supplied.get(area.toLowerCase()) || "" })),
      overheadMinutes: String(input.overheadMinutes ?? "").slice(0, 4),
      confidence: ["medium", "high"].includes(input.confidence) ? input.confidence : "",
      note: String(input.note || "").slice(0, 1000)
    };
  }

  function hasContent(values) {
    return values.decision === "needs-revision"
      || values.areaMinutes.some((row) => row.minutes !== "")
      || values.overheadMinutes !== ""
      || values.confidence !== ""
      || values.note.trim() !== "";
  }

  function saveScanReviewDraft(storage, contextInput, input = {}, now = Date.now()) {
    if (!storage?.setItem) return null;
    const context = contextModel(contextInput);
    const key = draftKey(context);
    if (!key) return null;
    const values = cleanValues(context, input);
    if (!hasContent(values)) {
      storage.removeItem?.(key);
      return null;
    }
    const savedAt = Number.isFinite(now) ? now : Date.now();
    const draft = { version, fingerprint: fingerprint(context), values, savedAt, expiresAt: savedAt + lifetimeMs };
    storage.setItem(key, JSON.stringify(draft));
    return draft;
  }

  function readScanReviewDraft(storage, contextInput, now = Date.now()) {
    if (!storage?.getItem) return null;
    const context = contextModel(contextInput);
    const key = draftKey(context);
    if (!key) return null;
    try {
      const value = JSON.parse(storage.getItem(key) || "null");
      const savedAt = Number(value?.savedAt);
      const expiresAt = Number(value?.expiresAt);
      const valid = value?.version === version
        && value?.fingerprint === fingerprint(context)
        && Number.isFinite(savedAt)
        && Number.isFinite(expiresAt)
        && expiresAt === savedAt + lifetimeMs
        && now >= savedAt - 5 * 60 * 1000
        && now < expiresAt;
      if (!valid) {
        storage.removeItem?.(key);
        return null;
      }
      const values = cleanValues(context, value.values);
      if (!hasContent(values)) {
        storage.removeItem?.(key);
        return null;
      }
      return { values, savedAt, expiresAt };
    } catch {
      storage.removeItem?.(key);
      return null;
    }
  }

  function clearScanReviewDraft(storage, contextInput) {
    const key = draftKey(contextModel(contextInput));
    if (key) storage?.removeItem?.(key);
  }

  globalObject.TidewayScanReviewDraft = Object.freeze({ version, lifetimeMs, fingerprint, saveScanReviewDraft, readScanReviewDraft, clearScanReviewDraft });
})(globalThis);
