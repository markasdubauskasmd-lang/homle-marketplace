function integer(value, minimum, maximum, fallback, label) {
  if (value == null) return fallback;
  if (!Number.isInteger(value) || value < minimum || value > maximum) throw new TypeError(`${label} is outside the supported range.`);
  return value;
}

function dateValue(clock) {
  const value = clock();
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new TypeError("Worker clock must return a valid Date.");
  return value;
}

function safeResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return Object.freeze({});
  const result = {};
  for (const [key, selected] of Object.entries(value)) {
    if (!/^[a-z][a-zA-Z0-9]{0,63}$/.test(key)) continue;
    if (typeof selected === "boolean") result[key] = selected;
    else if (Number.isSafeInteger(selected) && selected >= 0) result[key] = selected;
  }
  return Object.freeze(result);
}

function jobDefinition(value) {
  if (!value || !/^[a-z][a-z0-9-]{1,63}$/.test(value.name || "") || typeof value.runOnce !== "function") throw new TypeError("Each worker job requires a safe unique name and runOnce function.");
  return Object.freeze({
    name: value.name,
    runOnce: value.runOnce,
    intervalMs: integer(value.intervalMs, 1000, 86_400_000, null, `${value.name} interval`),
    retryMs: integer(value.retryMs, 1000, 3_600_000, Math.min(value.intervalMs, 30_000), `${value.name} retry interval`)
  });
}

export function createWorkerSupervisor(jobValues, options = {}) {
  if (!Array.isArray(jobValues) || !jobValues.length) throw new TypeError("At least one marketplace worker job is required.");
  const jobs = jobValues.map(jobDefinition);
  if (new Set(jobs.map((job) => job.name)).size !== jobs.length) throw new TypeError("Marketplace worker job names must be unique.");
  if (typeof options.onUnexpectedError !== "function") throw new TypeError("Marketplace workers require private operational error monitoring.");
  const onUnexpectedError = options.onUnexpectedError;
  const clock = typeof options.clock === "function" ? options.clock : () => new Date();
  const setTimer = typeof options.setTimer === "function" ? options.setTimer : setTimeout;
  const clearTimer = typeof options.clearTimer === "function" ? options.clearTimer : clearTimeout;
  const keepAlive = options.keepAlive !== false;
  const states = new Map(jobs.map((job) => [job.name, {
    name: job.name,
    intervalMs: job.intervalMs,
    running: false,
    timer: null,
    inFlight: null,
    runs: 0,
    successes: 0,
    failures: 0,
    consecutiveFailures: 0,
    lastStartedAt: null,
    lastCompletedAt: null,
    lastSucceededAt: null,
    nextRunAt: null,
    lastResult: Object.freeze({})
  }]));
  let started = false;
  let closed = false;

  function schedule(job, delayMs) {
    const state = states.get(job.name);
    if (closed || !started) return;
    if (state.timer) clearTimer(state.timer);
    const delay = Math.max(0, Math.trunc(delayMs));
    state.nextRunAt = new Date(dateValue(clock).getTime() + delay).toISOString();
    state.timer = setTimer(() => {
      state.timer = null;
      state.nextRunAt = null;
      void execute(job);
    }, delay);
    if (!keepAlive) state.timer?.unref?.();
  }

  async function execute(job) {
    const state = states.get(job.name);
    if (closed) return Object.freeze({ ran: false, reason: "closed" });
    if (state.running) return Object.freeze({ ran: false, reason: "already-running" });
    state.running = true;
    state.runs += 1;
    state.lastStartedAt = dateValue(clock).toISOString();
    const operation = (async () => {
      try {
        state.lastResult = safeResult(await job.runOnce());
        state.successes += 1;
        state.consecutiveFailures = 0;
        state.lastSucceededAt = dateValue(clock).toISOString();
        return Object.freeze({ ran: true, ok: true, result: state.lastResult });
      } catch (error) {
        state.failures += 1;
        state.consecutiveFailures += 1;
        try { await onUnexpectedError(error, Object.freeze({ component: "marketplace-worker", job: job.name, consecutiveFailures: state.consecutiveFailures })); } catch {}
        return Object.freeze({ ran: true, ok: false });
      } finally {
        state.running = false;
        state.lastCompletedAt = dateValue(clock).toISOString();
        state.inFlight = null;
        if (started && !closed) schedule(job, state.consecutiveFailures ? job.retryMs : job.intervalMs);
      }
    })();
    state.inFlight = operation;
    return operation;
  }

  function snapshot() {
    const observedAt = dateValue(clock).toISOString();
    const jobStates = jobs.map((job) => {
      const state = states.get(job.name);
      return Object.freeze({
        name: state.name,
        intervalMs: state.intervalMs,
        running: state.running,
        runs: state.runs,
        successes: state.successes,
        failures: state.failures,
        consecutiveFailures: state.consecutiveFailures,
        lastStartedAt: state.lastStartedAt,
        lastCompletedAt: state.lastCompletedAt,
        lastSucceededAt: state.lastSucceededAt,
        nextRunAt: state.nextRunAt,
        lastResult: state.lastResult
      });
    });
    return Object.freeze({
      enabled: true,
      started,
      closed,
      healthy: started && !closed && jobStates.every((job) => job.successes > 0 && job.consecutiveFailures === 0),
      observedAt,
      jobs: Object.freeze(jobStates)
    });
  }

  return Object.freeze({
    start({ runImmediately = true } = {}) {
      if (closed) throw new Error("The marketplace worker supervisor is closed.");
      if (started) return snapshot();
      started = true;
      for (const job of jobs) schedule(job, runImmediately ? 0 : job.intervalMs);
      return snapshot();
    },
    runNow(name) {
      const job = jobs.find((candidate) => candidate.name === name);
      if (!job) throw new TypeError("The requested marketplace worker job is not registered.");
      return execute(job);
    },
    snapshot,
    async close() {
      if (closed) return;
      closed = true;
      started = false;
      for (const state of states.values()) {
        if (state.timer) clearTimer(state.timer);
        state.timer = null;
        state.nextRunAt = null;
      }
      await Promise.allSettled([...states.values()].map((state) => state.inFlight).filter(Boolean));
    }
  });
}
