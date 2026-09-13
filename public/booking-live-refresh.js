// Refresh participant-owned bookings while the page is visible. Never sends mutations.
export function connectBookingRefresh(refresh, { intervalMs = 15000 } = {}) {
  let stopped = false, running = false, timer;
  async function update() {
    if (stopped || running || document.visibilityState === 'hidden' || navigator.onLine === false) return;
    running = true;
    try { await refresh(); } catch { /* Keep the last confirmed view until reconnect. */ }
    finally { running = false; }
  }
  function schedule() { clearTimeout(timer); if (!stopped) timer = setTimeout(async () => { await update(); schedule(); }, intervalMs); }
  function wake() { void update(); }
  function resume() { stopped = false; schedule(); wake(); }
  function pause() { stopped = true; clearTimeout(timer); }
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
  window.addEventListener('homle:notification-updated', wake);
  window.addEventListener('pagehide', pause);
  window.addEventListener('pageshow', resume);
  schedule();
  return () => { pause(); document.removeEventListener('visibilitychange', wake); for (const event of ['focus','online','homle:notification-updated']) window.removeEventListener(event,wake); window.removeEventListener('pagehide',pause); window.removeEventListener('pageshow',resume); };
}
