import { createHash, randomUUID } from "node:crypto";

export const builtInMonitoringAdapter = "homle:monitoring-webhook";

function exactHttpsEndpoint(value) {
  const supplied = String(value || "").trim();
  if (!supplied || supplied.length > 2048) throw new TypeError("MONITORING_WEBHOOK_URL is required for the built-in monitoring adapter.");
  let endpoint;
  try { endpoint = new URL(supplied); } catch { throw new TypeError("MONITORING_WEBHOOK_URL must be a valid HTTPS URL."); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.hash || endpoint.origin === "null") {
    throw new TypeError("MONITORING_WEBHOOK_URL must use HTTPS without credentials or a fragment.");
  }
  return endpoint.href;
}

function privateToken(value) {
  const supplied = String(value || "");
  if (supplied.length < 32 || supplied.length > 512 || /[\u0000-\u0020\u007f]/.test(supplied) || /replace|example|changeme|password/i.test(supplied)) {
    throw new TypeError("MONITORING_WEBHOOK_TOKEN must be a non-placeholder 32-512 character secret without whitespace.");
  }
  return supplied;
}

function timeoutMilliseconds(value) {
  if (value === undefined || value === null || String(value).trim() === "") return 5000;
  const selected = Number(value);
  if (!Number.isInteger(selected) || selected < 1000 || selected > 10_000) throw new TypeError("MONITORING_WEBHOOK_TIMEOUT_MS must be a whole number from 1000 to 10000.");
  return selected;
}

function boundedCounter(value) {
  const selected = Number(value);
  return Number.isInteger(selected) && selected >= 0 ? Math.min(selected, 1_000_000) : undefined;
}

function safeLabel(value, fallback = "unclassified") {
  const supplied = String(value || "").trim().toLowerCase();
  return /^[a-z][a-z0-9._-]{0,63}$/.test(supplied) ? supplied : fallback;
}

function safeErrorCode(value) {
  const supplied = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{0,63}$/.test(supplied) ? supplied : undefined;
}

function errorFingerprint(error) {
  const source = error instanceof Error ? `${error.name}\n${error.message}` : String(error || "unknown error");
  return createHash("sha256").update(source).digest("hex");
}

function privateEvent(error, context, options) {
  const payload = {
    schemaVersion: 1,
    eventId: options.eventId(),
    eventType: "unexpected-error",
    service: "homle-marketplace",
    environment: "production",
    occurredAt: options.now().toISOString(),
    error: {
      type: safeLabel(error?.name, "error"),
      fingerprintSha256: errorFingerprint(error)
    },
    context: {
      component: safeLabel(context?.component),
      operation: safeLabel(context?.operation),
      job: safeLabel(context?.job)
    }
  };
  const code = safeErrorCode(error?.code);
  const consecutiveFailures = boundedCounter(context?.consecutiveFailures);
  if (code) payload.error.code = code;
  if (consecutiveFailures !== undefined) payload.context.consecutiveFailures = consecutiveFailures;
  return Object.freeze(payload);
}

export function validateMonitoringWebhookEnvironment(env = process.env) {
  const errors = [];
  try { exactHttpsEndpoint(env.MONITORING_WEBHOOK_URL); } catch (error) { errors.push(error.message); }
  try { privateToken(env.MONITORING_WEBHOOK_TOKEN); } catch (error) { errors.push(error.message); }
  try { timeoutMilliseconds(env.MONITORING_WEBHOOK_TIMEOUT_MS); } catch (error) { errors.push(error.message); }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function createMonitoringWebhook(options = {}) {
  const endpoint = exactHttpsEndpoint(options.endpoint);
  const token = privateToken(options.token);
  const timeoutMs = timeoutMilliseconds(options.timeoutMs);
  const fetchImplementation = options.fetch || globalThis.fetch;
  if (typeof fetchImplementation !== "function") throw new TypeError("The monitoring adapter requires fetch.");
  const now = options.now || (() => new Date());
  const eventId = options.eventId || randomUUID;
  const fallback = options.fallback || ((value) => console.error(JSON.stringify(value)));
  const maximumPending = Number.isInteger(options.maximumPending) && options.maximumPending > 0 ? Math.min(options.maximumPending, 100) : 25;
  const pending = new Set();
  let closed = false;
  let overflowReported = false;

  function fallbackEvent(event, eventIdentifier) {
    try { fallback(Object.freeze({ service: "homle-marketplace", event, eventId: eventIdentifier || undefined })); } catch {}
  }

  function onUnexpectedError(error, context = {}) {
    if (closed) return Promise.resolve(false);
    if (pending.size >= maximumPending) {
      if (!overflowReported) {
        overflowReported = true;
        fallbackEvent("monitoring-queue-full");
      }
      return Promise.resolve(false);
    }
    const event = privateEvent(error, context, { now, eventId });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    const delivery = (async () => {
      try {
        const response = await fetchImplementation(endpoint, {
          method: "POST",
          redirect: "error",
          signal: controller.signal,
          headers: {
            "authorization": `Bearer ${token}`,
            "content-type": "application/json; charset=utf-8",
            "user-agent": "Homle-Monitoring/1.0"
          },
          body: JSON.stringify(event)
        });
        await response.body?.cancel?.();
        if (!response.ok) throw new Error("Monitoring endpoint rejected the event.");
        return true;
      } catch {
        fallbackEvent("monitoring-delivery-failed", event.eventId);
        return false;
      } finally {
        clearTimeout(timer);
      }
    })();
    pending.add(delivery);
    delivery.finally(() => {
      pending.delete(delivery);
      if (pending.size < maximumPending) overflowReported = false;
    });
    return delivery;
  }

  return Object.freeze({
    onUnexpectedError,
    async close() {
      if (closed) return;
      closed = true;
      await Promise.allSettled([...pending]);
    }
  });
}

export async function createMarketplaceDeploymentAdapters({ env = process.env } = {}) {
  const monitoring = createMonitoringWebhook({
    endpoint: env.MONITORING_WEBHOOK_URL,
    token: env.MONITORING_WEBHOOK_TOKEN,
    timeoutMs: env.MONITORING_WEBHOOK_TIMEOUT_MS
  });
  return Object.freeze({
    onUnexpectedError: monitoring.onUnexpectedError,
    close: monitoring.close
  });
}
