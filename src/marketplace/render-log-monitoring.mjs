import { privacySafeMonitoringEvent } from "./monitoring-webhook.mjs";

export const builtInRenderLogMonitoringAdapter = "homle:render-log-monitoring";

function enabled(value) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function validateRenderLogMonitoringEnvironment(env = process.env) {
  const errors = [];
  if (env.NODE_ENV !== "production") errors.push("Render log monitoring requires NODE_ENV=production.");
  if (env.RENDER !== "true" || !new Set(["web", "worker", "pserv", "cron"]).has(String(env.RENDER_SERVICE_TYPE || ""))) errors.push("Render log monitoring may run only inside an authenticated Render service.");
  if (!enabled(env.RENDER_LOG_MONITORING_ACKNOWLEDGED)) errors.push("RENDER_LOG_MONITORING_ACKNOWLEDGED must be true after confirming workspace log access is restricted.");
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) });
}

export function createRenderLogMonitoring(options = {}) {
  const validation = validateRenderLogMonitoringEnvironment(options.env || process.env);
  if (!validation.ok) throw new TypeError(validation.errors.join(" "));
  const write = options.write || ((line) => console.error(line));
  if (typeof write !== "function") throw new TypeError("Render log monitoring requires a write function.");
  let closed = false;

  function onUnexpectedError(error, context = {}) {
    if (closed) return Promise.resolve(false);
    const event = privacySafeMonitoringEvent(error, context, { now: options.now, eventId: options.eventId });
    const record = Object.freeze({ ...event, channel: "render-log" });
    try {
      write(JSON.stringify(record));
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }

  return Object.freeze({
    onUnexpectedError,
    async close() { closed = true; }
  });
}

export async function createMarketplaceDeploymentAdapters({ env = process.env } = {}) {
  return createRenderLogMonitoring({ env });
}
