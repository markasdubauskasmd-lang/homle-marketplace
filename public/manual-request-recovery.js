import { landlordRequestDraftLifetimeMs } from "./landlord-request-draft.js";

const storageKey = "homleManualRequestRetryV1";
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Persist only a scope digest and retry identity, never notes, prices, photos or
// approval. A changed body starts a new draft. Uncertain writes keep their ID.
export function createManualRequestRecovery({ requestJson, getStorage, crypto = globalThis.crypto, clock = Date.now }) {
  let retry = null;
  const storage = () => { try { return getStorage?.(); } catch { return null; } };
  return async function saveManualRequest(csrf, body) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(body)));
    const fingerprint = Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("");
    const now = clock();
    if (!retry) {
      try { retry = JSON.parse(storage()?.getItem(storageKey) || "null"); } catch { retry = null; }
    }
    if (!uuid.test(retry?.id || "") || retry?.fingerprint !== fingerprint
      || !Number.isFinite(retry?.createdAt) || now < retry.createdAt - 5 * 60 * 1000
      || now >= retry.createdAt + landlordRequestDraftLifetimeMs) {
      retry = { id: crypto.randomUUID(), fingerprint, createdAt: now };
    }
    try { storage()?.setItem(storageKey, JSON.stringify(retry)); } catch {}
    const id = retry.id;
    let result;
    try {
      result = await requestJson("/api/marketplace/cleaning-requests", {
        method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({ ...body, id })
      });
      if (result.cleaningRequest?.requestId !== id) throw new Error("The saved cleaning-request draft could not be verified.");
    } catch (error) {
      if (!["request-timeout", "browser-offline"].includes(error?.code) && error?.statusCode !== 409) throw error;
      const own = await requestJson("/api/marketplace/cleaning-requests");
      const recovered = (own.cleaningRequests || []).find(request => request.requestId === id);
      if (!recovered) throw error;
      result = { cleaningRequest: recovered };
    }
    retry = null;
    try { storage()?.removeItem(storageKey); } catch {}
    return result;
  };
}
