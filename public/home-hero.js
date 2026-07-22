// Scroll-scrubbed "scan the room clean" hero for the landing page.
//
// A single scalar drives everything: p = how far through the pinned stage the
// page has scrolled (0 → 1). Every visual is derived from p and written with
// element.style — never an inline style attribute in markup, which the site's
// Content-Security-Policy (style-src 'self') would block.
//
// The maths mirrors the approved design reference exactly: a green beam sweeps
// left→right (beamPct), each object cleans as the beam passes its x position
// (at(x)), the room brightens (ease(p)), and a phone/progress read counts up.

const wrap = document.querySelector("[data-scan-wrap]");
const stage = document.querySelector("[data-stage]");
if (wrap && stage) {
  const el = {
    bright: document.querySelector("[data-bright]"),
    beam: document.querySelector("[data-beam]"),
    scanned: document.querySelector("[data-scanned]"),
    sparkles: document.querySelector("[data-sparkles]"),
    badge: document.querySelector("[data-badge]"),
    scrollcue: document.querySelector("[data-scrollcue]"),
    barfill: document.querySelector("[data-barfill]"),
    pct: [...document.querySelectorAll("[data-pct]")],
    status: [...document.querySelectorAll("[data-status]")],
    frame: document.querySelector("[data-frame]"),
    lamp: document.querySelector("[data-lamp]"),
    plant: document.querySelector("[data-plant]"),
    cushionA: document.querySelector('[data-cushion="a"]'),
    cushionB: document.querySelector('[data-cushion="b"]'),
    clutter: [...document.querySelectorAll("[data-clutter]")]
  };

  // Each object's horizontal position in the scene (0–100) and, for clutter,
  // the messy angle it holds as it settles away. Straightening furniture uses
  // the same x to time its rotation back to level.
  const clutterConfig = {
    blanket: { x: 14, rot: 0 }, pillow1: { x: 5, rot: -16 }, pillow2: { x: 29, rot: 18 },
    mags: { x: 44, rot: -6 }, paper: { x: 55, rot: 0 }, mug: { x: 29, rot: 0 },
    box: { x: 39, rot: 6 }, glass: { x: 24, rot: 0 }, sock: { x: 65, rot: 24 }, remote: { x: 76, rot: -12 }
  };
  const furniture = [
    { node: el.frame, tilt: -7, x: 8 },
    { node: el.lamp, tilt: 9, x: 82 },
    { node: el.plant, tilt: 7, x: 93 },
    { node: el.cushionA, tilt: -16, x: 16 },
    { node: el.cushionB, tilt: 14, x: 22 }
  ];

  const clamp = (x) => Math.max(0, Math.min(1, x));
  const ease = (t) => t * t * (3 - 2 * t);

  function render(p) {
    const ep = ease(p);
    const pct = Math.round(p * 100);
    const beamPct = -8 + p * 128;
    const beamOpacity = clamp(Math.min(p * 8, (1 - p) * 8, 1));
    const badgeIn = clamp((p - 0.6) * 2.6);
    // How clean the object at position x is: the beam starts working on it about
    // 12% before it arrives and finishes as it passes.
    const at = (x) => ease(clamp((beamPct - x) / 12));

    if (el.bright) el.bright.style.opacity = String(ep);
    if (el.beam) { el.beam.style.left = `${beamPct}%`; el.beam.style.opacity = String(beamOpacity); }
    if (el.scanned) el.scanned.style.width = `${Math.max(0, beamPct)}%`;
    if (el.sparkles) el.sparkles.style.opacity = String(clamp((p - 0.5) * 2.4));
    if (el.badge) el.badge.style.opacity = String(badgeIn);
    if (el.scrollcue) el.scrollcue.style.opacity = String(clamp(1 - p * 3));
    if (el.barfill) el.barfill.style.width = `${pct}%`;

    const statusLabel = pct >= 100 ? "Room reset ✨" : pct > 3 ? "Scanning…" : "Point & scan";
    for (const node of el.pct) node.textContent = `${pct}%`;
    for (const node of el.status) node.textContent = statusLabel;

    for (const item of furniture) {
      if (item.node) item.node.style.transform = `rotate(${item.tilt * (1 - at(item.x))}deg)`;
    }
    for (const node of el.clutter) {
      const config = clutterConfig[node.dataset.clutter];
      if (!config) continue;
      const s = at(config.x);
      node.style.opacity = String(1 - s);
      node.style.transform = `translateY(${18 * s}px) scale(${1 - 0.28 * s}) rotate(${config.rot}deg)`;
    }
  }

  const still = window.matchMedia("(prefers-reduced-motion: reduce)");

  // The scan is scroll-scrubbed on every screen size — the stage stays pinned on
  // mobile too. Only when motion is unwelcome is it skipped, showing the calm,
  // finished room instead.
  function isStatic() { return still.matches; }

  function progress() {
    const range = wrap.offsetHeight - window.innerHeight;
    if (range <= 0) return 0;
    const scrolled = window.scrollY - wrap.offsetTop;
    return clamp(scrolled / range);
  }

  let ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      if (isStatic()) { render(1); return; }
      render(progress());
    });
  }

  function bind() {
    if (isStatic()) {
      window.removeEventListener("scroll", onScroll);
      render(1);
    } else {
      window.addEventListener("scroll", onScroll, { passive: true });
      render(progress());
    }
  }

  bind();
  // Rotating the phone or resizing changes the pinned range; recompute against it.
  window.addEventListener("resize", bind, { passive: true });
  const watch = (query) => (query.addEventListener ? query.addEventListener("change", bind) : query.addListener(bind));
  watch(still);
}
