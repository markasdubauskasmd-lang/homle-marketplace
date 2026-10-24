function temporaryFailure(message, cause, onUnexpectedError) {
  onUnexpectedError(cause);
  return Object.assign(new Error(message), { statusCode: 503, code: "abuse-control-unavailable", cause });
}

export function createRateLimitBoundary(rateLimiter, clientKeyResolver, options = {}) {
  if (!rateLimiter || typeof rateLimiter.consume !== "function") throw new TypeError("A shared rate limiter is required.");
  if (typeof clientKeyResolver !== "function") throw new TypeError("A trusted client-key resolver is required.");
  const onUnexpectedError = typeof options.onUnexpectedError === "function" ? options.onUnexpectedError : () => {};
  const requestKeys = new WeakMap();

  function clientKey(request) {
    if (request && typeof request === "object" && requestKeys.has(request)) return requestKeys.get(request);
    try {
      const key = String(clientKeyResolver(request) || "");
      if (!key || key.length > 200 || /[\u0000-\u001f\u007f]/.test(key)) throw new TypeError("The trusted client key is invalid.");
      if (request && typeof request === "object") requestKeys.set(request, key);
      return key;
    } catch (error) {
      throw temporaryFailure("Request protection is temporarily unavailable. Try again later.", error, onUnexpectedError);
    }
  }

  async function limit(request, scope) {
    if (typeof scope !== "string" || !/^[a-z0-9][a-z0-9:-]{0,99}$/.test(scope)) throw new TypeError("A bounded rate-limit scope is required.");
    const key = clientKey(request);

    let result;
    try {
      result = await rateLimiter.consume({ scope, key });
    } catch (error) {
      throw temporaryFailure("Request protection is temporarily unavailable. Try again later.", error, onUnexpectedError);
    }

    if (result?.allowed === true) return;
    if (result?.allowed !== false) {
      throw temporaryFailure("Request protection is temporarily unavailable. Try again later.", new TypeError("The shared rate limiter returned an invalid decision."), onUnexpectedError);
    }

    const retryAfterSeconds = Math.max(1, Math.min(3600, Number(result.retryAfterSeconds) || 60));
    throw Object.assign(new Error("Too many requests. Try again later."), { statusCode: 429, code: "rate-limited", retryAfterSeconds });
  }

  limit.clientKey = clientKey;

  /**
   * A ceiling shared by everybody, rather than one bucket per client.
   *
   * Per-client limits bound what one session can do. They do not bound what a
   * thousand honest sessions cost, and for a metered provider that is the bill
   * that actually arrives. The key is a constant so every request on every
   * instance lands in the same bucket, which makes this a real spend ceiling
   * rather than a per-process guess.
   *
   * Returns false instead of throwing when the ceiling is reached, because the
   * caller's right answer is to degrade to the on-device path, not to show the
   * customer an error. A limiter that is itself unavailable still throws: that
   * is an outage, not a budget decision, and it must not silently disable the
   * ceiling.
   */
  limit.platform = async function platformLimit(scope) {
    if (typeof scope !== "string" || !/^[a-z0-9][a-z0-9:-]{0,99}$/.test(scope)) throw new TypeError("A bounded rate-limit scope is required.");
    let result;
    try {
      result = await rateLimiter.consume({ scope, key: "platform" });
    } catch (error) {
      throw temporaryFailure("Request protection is temporarily unavailable. Try again later.", error, onUnexpectedError);
    }
    if (result?.allowed === true) return true;
    if (result?.allowed === false) return false;
    throw temporaryFailure("Request protection is temporarily unavailable. Try again later.", new TypeError("The shared rate limiter returned an invalid decision."), onUnexpectedError);
  };

  return limit;
}
