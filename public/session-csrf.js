// One owner for reading the CSRF token the server issued for this session.
//
// This was written out ten times, byte-identical every time — the only helper in
// the tree with no drift at all, which is exactly why it is safe to share.
//
// The `try` is not decoration. `sessionStorage` throws on access, not just on
// write, when the browser blocks storage: Safari in Lockdown Mode, a strict
// third-party-context policy, or a WebView with storage disabled. Every caller
// uses the result as a request header, so throwing here would take down the
// action rather than let the server answer with a clear CSRF failure. Returning
// "" sends the request without a token and lets the server reject it properly.
export function storedCsrf() {
  try { return sessionStorage.getItem("tideway_csrf") || ""; } catch { return ""; }
}
