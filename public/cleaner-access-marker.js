// Remembers only that this tab already confirmed a Cleaner workspace. No account data is
// stored. The marker is per-tab (sessionStorage), is cleared the moment a check comes back
// denied, and never grants access on its own: every API call is enforced server-side, so the
// worst case is a page painting its own chrome a moment before the check closes it again.
//
// It lives in its own module because two things now depend on it — the page bootstrap that
// reveals the content, and the sidebar that decides whether to state a Cleaner workspace
// exists at all. Two copies of a rule about what may be shown to whom is how the drift this
// audit removed began.
const cleanerAccessMarker = "homle.cleaner.access";

export function rememberedCleanerAccess() {
  try { return window.sessionStorage.getItem(cleanerAccessMarker) === "ready"; }
  catch { return false; }
}

export function rememberCleanerAccess(ready) {
  try {
    if (ready) window.sessionStorage.setItem(cleanerAccessMarker, "ready");
    else window.sessionStorage.removeItem(cleanerAccessMarker);
  } catch { /* Private browsing can refuse storage; the check simply runs visibly instead. */ }
}
