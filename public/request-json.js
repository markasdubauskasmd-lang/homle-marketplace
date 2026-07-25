// One owner for the private JSON request.
//
// This was written out fourteen times, once per page module. Eight of those were
// the same handful of lines with a different failure message; they now share this.
// Six keep their own on purpose — they detect offline state, word failures
// differently for a mutation than for a read, and for payments set an `uncertain`
// flag meaning "a step may already have been prepared; check before retrying".
// That language exists because a retried payment is not free.
//
// DELIBERATELY BEHAVIOUR-PRESERVING. Every option below exists because one of the
// eight did something slightly different, and consolidating is only worth doing if
// it changes nothing. An earlier version of this file normalised those differences
// away and introduced three regressions, all caught in review:
//
//   * It gave every module a 15-second timeout. Seven had none. That is a real
//     gap — a stalled request leaves the spinner and the disabled submit button up
//     forever — but a bare timeout is the wrong fix for a mutation. Aborting the
//     fetch does not stop the server, `active-job`'s "add unexpected task" has no
//     idempotency key, and the message said "try again", so the abort could
//     produce a duplicate task. Worse, `cleaner-payouts` reaches Stripe, which the
//     server configures with a 10s timeout and two retries, so 15s in the browser
//     is shorter than the server's own valid budget and would abort onboarding
//     that was working. Timeouts are therefore opt-in per module here, and closing
//     the gap properly — a bound plus honest uncertain-result wording, the way the
//     six rich variants already do it — is separate work.
//   * It required `result.ok === true` for all eight. Two checked only
//     `!response.ok`. Dormant today, since the server does send `ok`, but not the
//     same contract. Hence `requireResultOk`.
//   * It changed `active-job`'s default error code from "request-failed" to "".
//     Hence `failureCode`.
//
// What every caller does get, uniformly:
//   * `credentials: "same-origin"` and `cache: "no-store"` — a private request
//     must carry the session and must not be cached.
//   * `Accept: application/json` — two modules omitted it, so a proxy or error
//     page could answer with HTML that then failed to parse as a generic error.
//   * The HTTP status under BOTH `status` and `statusCode`. Eleven modules read
//     `statusCode` and three read `status`; each happened to read back whatever
//     its own copy set, so nothing was broken, but any handler moved between
//     modules would have silently read `undefined`. Setting both closes that
//     without touching 62 existing readers.
//
// The failure message stays per-module: "Your availability could not be updated"
// is what the person reads, and a generic replacement would be a downgrade.

export function createRequestJson({
  failureMessage,
  // Opt-in. `undefined` means no timeout, which is what seven of the eight had.
  timeoutMs,
  timeoutMessage = "",
  // `active-job` and `cleaner-payouts` accepted any parsed 2xx body.
  requireResultOk = true,
  // `active-job` fell back to "request-failed" rather than "".
  failureCode = ""
} = {}) {
  if (typeof failureMessage !== "string" || !failureMessage.trim()) {
    throw new TypeError("A private JSON request needs a human failure message for the person reading the page.");
  }

  return async function requestJson(path, options = {}, overrideTimeoutMs = timeoutMs) {
    const { headers = {}, ...rest } = options;
    const bounded = Number.isFinite(overrideTimeoutMs) && overrideTimeoutMs > 0;
    const controller = bounded ? new AbortController() : null;
    // `window.setTimeout` rather than the bare global, so a torn-down page cannot
    // leave a timer running against a dead document.
    const timer = bounded ? window.setTimeout(() => controller.abort(), overrideTimeoutMs) : null;
    try {
      const response = await fetch(path, {
        credentials: "same-origin",
        cache: "no-store",
        ...(controller ? { signal: controller.signal } : {}),
        ...rest,
        headers: { Accept: "application/json", ...headers }
      });
      let result = {};
      try { result = await response.json(); } catch {}
      // `result.ok !== true` matters as much as the HTTP status where a module
      // asked for it. A 200 carrying an error body read as success is how the
      // availability list was wiped: an undefined record was appended and the next
      // render threw on it.
      if (!response.ok || (requireResultOk && result.ok !== true)) {
        throw Object.assign(new Error(result.error || failureMessage), {
          // Both names, deliberately. See the note above.
          status: response.status,
          statusCode: response.status,
          code: result.code || failureCode
        });
      }
      return result;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw Object.assign(new Error(timeoutMessage || "That took too long. Check your connection and try again."), { code: "request-timeout" });
      }
      throw error;
    } finally {
      if (timer !== null) window.clearTimeout(timer);
    }
  };
}
