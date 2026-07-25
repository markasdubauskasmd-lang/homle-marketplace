// One owner for the private JSON request.
//
// This was written out fourteen times, once per page module, and the copies had
// drifted apart in ways that were invisible until you lined them up:
//
//   * TWELVE OF FOURTEEN HAD NO TIMEOUT. A stalled connection — a phone moving
//     between cells, a proxy holding the socket open — left the promise pending
//     forever, so the spinner span, the disabled submit button and the "Saving…"
//     state never came back. Only `account-menu` and `admin-payments` could
//     recover. This is the reason the duplication was worth removing, and it is a
//     reliability fix rather than a tidying one.
//   * Two omitted `Accept: application/json`, so a proxy or error page was free to
//     answer them with HTML that then failed to parse as a generic error.
//   * Eleven attached the HTTP status as `statusCode`, three as `status`. Each
//     module happened to read back whatever its own copy set, so nothing was
//     broken — but any code moved between modules, or any shared handler added
//     later, would silently read `undefined` and take the wrong branch. Both names
//     are set here so that trap is closed without touching 62 existing readers.
//
// The failure message stays per-module: "Your availability could not be updated"
// and "The booking-case action could not be completed" are what the person reads,
// and a generic replacement would be a downgrade.

// Long enough that a slow-but-working request on a poor mobile connection is not
// cut off, short enough that a wedged one gives the interface back. `account-menu`
// already used this value; it is now what every module gets.
const defaultTimeoutMs = 15_000;

export function createRequestJson({ failureMessage, timeoutMs = defaultTimeoutMs, timeoutMessage = "" } = {}) {
  if (typeof failureMessage !== "string" || !failureMessage.trim()) {
    throw new TypeError("A private JSON request needs a human failure message for the person reading the page.");
  }

  return async function requestJson(path, options = {}, overrideTimeoutMs = timeoutMs) {
    const { headers = {}, ...rest } = options;
    const controller = new AbortController();
    // `window.setTimeout` rather than the bare global so a page that has been torn
    // down cannot leave a timer running against a dead document.
    const timer = window.setTimeout(() => controller.abort(), overrideTimeoutMs);
    try {
      const response = await fetch(path, {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        ...rest,
        headers: { Accept: "application/json", ...headers }
      });
      let result = {};
      try { result = await response.json(); } catch {}
      // `result.ok !== true` matters as much as the HTTP status. A 200 carrying an
      // error body read as success is how the availability list was wiped: an
      // undefined record was appended and the next render threw on it.
      if (!response.ok || result.ok !== true) {
        throw Object.assign(new Error(result.error || failureMessage), {
          // Both names, deliberately. See the note above.
          status: response.status,
          statusCode: response.status,
          code: result.code || ""
        });
      }
      return result;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw Object.assign(new Error(timeoutMessage || "That took too long. Check your connection and try again."), { code: "request-timeout" });
      }
      throw error;
    } finally {
      window.clearTimeout(timer);
    }
  };
}
