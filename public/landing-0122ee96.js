/*
 * Homle landing page — scroll direction for the "Cinematic" design.
 *
 * Ported from the Claude Design handoff, which shipped this as a `DCLogic`
 * component with an inline <script> and template props. This site sends
 * `script-src 'self'`, so it lives in a real module, and the two props the
 * component exposed are now fixed: the accent is the brand red, and motion is
 * on unless the visitor asked for less of it.
 *
 * How it works: every [data-stage] section is tall, and its first child is
 * sticky. As the section passes, we publish its progress as `--p` (0 -> 1) on
 * the section itself. Nearly all of the animation is CSS reading that variable.
 * This file only computes what CSS cannot: the room walk, where the phone, the
 * room plate and the read-out have to agree on where the camera is pointing.
 *
 * Two rules keep it smooth: all layout reads (getBoundingClientRect, offsetHeight)
 * happen before any style writes in a frame, and the loop stops itself once
 * nothing is moving rather than running rAF forever.
 */

const ACCENT = "#e94549";
const IDLE = "rgba(244, 242, 238, .16)";

/* Which angle image each beat looks at, and what the read-out says while it does.
   One continuous circuit: wide -> bar wall -> back wall -> seating -> windows -> wide. */
const BEATS = [
  { ang: 1, room: { s: 1.05, x: 0,  y: 0  }, ph: { x: 5,    y: 0.4,  yaw: -6, roll: -0.8, s: 0.97 },
    box: null,             title: "Reading the room…",     label: "Point at the room to begin", items: 0,  name: "Lounge" },
  { ang: 2, room: { s: 1.14, x: 7,  y: 1  }, ph: { x: -4.5, y: -1.2, yaw: 8,  roll: 1.1,  s: 1.03 },
    box: [6, 22, 32, 54],  title: "Bar wall · scanning",   label: "Cabinet & glassware",        items: 10, name: "Lounge" },
  { ang: 2, room: { s: 1.3,  x: 11, y: 3  }, ph: { x: -6,   y: -1.8, yaw: 6,  roll: 0.9,  s: 1.05 },
    box: [10, 30, 28, 44], title: "Bottles & shelving",    label: "Reading surfaces…",          items: 18, name: "Lounge" },
  { ang: 3, room: { s: 1.16, x: -2, y: -3 }, ph: { x: 5,    y: 1,    yaw: -7, roll: -1.1, s: 1.06 },
    box: [36, 16, 26, 30], title: "Mirror & wall",         label: "Mirror detected",            items: 24, name: "Lounge" },
  { ang: 4, room: { s: 1.24, x: 0,  y: -5 }, ph: { x: 0.5,  y: 2,    yaw: -3, roll: -0.5, s: 1.08 },
    box: [22, 56, 54, 34], title: "Reading floor condition…", label: "Floor finish detected",    items: 30, name: "Lounge" },
  { ang: 4, room: { s: 1.1,  x: -3, y: 1  }, ph: { x: -5,   y: 1.2,  yaw: 6,  roll: 0.9,  s: 1.02 },
    box: [30, 36, 50, 38], title: "Seating & textiles",    label: "Soft furnishings",           items: 36, name: "Lounge" },
  { ang: 5, room: { s: 1.16, x: -7, y: -3 }, ph: { x: 3.5,  y: -1.4, yaw: -5, roll: -0.7, s: 1.04 },
    box: [52, 14, 40, 52], title: "Windows & lighting",    label: "Glass & frames",             items: 40, name: "Lounge" },
  { ang: 1, room: { s: 1.05, x: 0,  y: 0  }, ph: { x: 0,    y: 0,    yaw: 0,  roll: 0,    s: 1 },
    box: null,             title: "Scan complete",         label: "Room understood · review scope", items: 42, name: "Lounge" }
];

/* The phone shows the very angle being scanned. Beat angle -> file number. */
const ANGLE_FILE = { 1: 5, 2: 1, 3: 4, 4: 2, 5: 3 };

class Cinematic {
  constructor(root) {
    this.root = root;
    this.cur = {};
    this.last = {};
    this.marks = new Map();
    this.running = false;
    this.raf = null;
    this.beatIdx = null;
    this.frame = this.frame.bind(this);
    this.onScroll = () => this.start();
    this.onResize = () => { this.measure(); this.start(); };
    this.onWake = () => { this.measure(); this.start(); };
  }

  collect() {
    const q = (sel) => Array.from(this.root.querySelectorAll(sel));
    const one = (sel) => this.root.querySelector(sel);

    this.stages = q("[data-stage]");
    this.tels = q("[data-tel]");
    this.msteps = q("[data-mstep]");
    this.mdots = q("[data-mdot]");
    this.launch = q("[data-launch]");
    this.joins = q("[data-join]");
    this.angles = q("[data-angle]");

    this.phone = one("[data-phone]");
    this.phoneView = one("[data-phone-view]");
    this.scanline = one("[data-scanline]");
    this.views = one("[data-views]");
    this.status = one("[data-scanstatus]");
    this.heroFrame = one("[data-hero-frame]");
    this.beatTitle = one("[data-beat-title]");
    this.beatLabel = one("[data-beat-label]");
    this.beatItems = one("[data-beat-items]");
    this.beatRoom = one("[data-beat-room]");
    this.beatBox = one("[data-beat-box]");
    this.room = one("[data-room]");
    this.roomLight = one("[data-room-light]");
    this.roomGrid = one("[data-room-grid]");
    this.mwrap = one("[data-mwrap]");
    this.mcard = one("[data-mcard]");
    this.mnum = one("[data-mnum]");
    this.mhours = one("[data-mhours]");
    this.detailVideo = one("[data-detail-video]");

    if (this.detailVideo) {
      this.detailVideoSource = this.detailVideo.dataset.videoSrc || "";
      this.detailVideoPoster = this.detailVideo.dataset.videoPoster || "";
      this.detailVideo.muted = true;
      this.detailVideo.playbackRate = 0.85;
    }
    return this.stages.length >= 5 && Boolean(this.phone) && Boolean(this.mcard);
  }

  /* Keep the below-the-fold clip off the initial network path. Its poster is
     already visible, so loading the MP4 before this act approaches only spends
     data and decoding time on visitors who may never reach it. */
  activateDetailVideo() {
    if (!this.detailVideo || this.detailVideo.getAttribute("src") || !this.detailVideoSource) return;
    if (this.detailVideoPoster) this.detailVideo.setAttribute("poster", this.detailVideoPoster);
    this.detailVideo.setAttribute("src", this.detailVideoSource);
    this.detailVideo.load();
  }

  setup() {
    if (!this.collect()) return;

    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.motion = !reduce;
    this.measure();
    if (!this.motion) { this.settle(); return; }

    window.addEventListener("scroll", this.onScroll, { passive: true });
    window.addEventListener("resize", this.onResize);
    window.addEventListener("load", this.onWake);
    window.addEventListener("pageshow", this.onWake);
    document.addEventListener("visibilitychange", this.onWake);
    this.start();
  }

  /* Layout reads happen here only — never inside the scroll frame. The booking
     card is authored at 620px wide; scale it to whatever space is left. */
  measure() {
    if (!this.mwrap || !this.mcard) return;
    const wrapH = this.mwrap.clientHeight || window.innerHeight;
    const visH = Math.min(wrapH, window.innerHeight);
    const h = this.mcard.offsetHeight || 1;
    const sc = Math.max(0.45, Math.min(1, (this.mwrap.clientWidth - 8) / 620, (visH - 40) / h));
    this.cardScale = sc;
    this.cardY = (visH - h * sc) / 2 - (wrapH - h * sc) / 2;
  }

  /* Reduced motion: show every act at its finished state instead of its first. */
  settle() {
    [...(this.launch || []), ...(this.joins || []), ...(this.tels || []), ...(this.msteps || [])]
      .forEach((el) => el.classList.add("is-on"));
    (this.mdots || []).forEach((el) => el.classList.add("is-on"));
    if (this.mcard && this.cardScale) {
      this.mcard.style.transform =
        `translateY(${this.cardY.toFixed(1)}px) scale(${this.cardScale.toFixed(3)})`;
    }
    const done = BEATS[BEATS.length - 1];
    this.text(this.beatItems, String(done.items));
    this.text(this.views, "4");
    this.text(this.status, "Room understood");
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.frame);
  }

  frame() {
    this.raf = null;
    const vh = window.innerHeight || 800;
    const stages = this.stages || [];

    /* ---- read phase: rects only ---- */
    const reads = [];
    for (const st of stages) {
      const r = st.getBoundingClientRect();
      reads.push({
        st,
        kind: st.dataset.stage,
        p: Math.max(0, Math.min(1, -r.top / Math.max(1, r.height - vh))),
        near: r.top < vh * 1.35 && r.bottom > -vh * 0.35
      });
    }

    /* ---- ease toward the scroll position, frame-rate independent, so it glides ---- */
    const now = performance.now();
    const dt = Math.min(64, Math.max(8, now - (this.t0 || now - 16.7)));
    this.t0 = now;
    const k = 1 - Math.pow(1 - 0.13, dt / 16.67);
    let moving = false;
    for (const o of reads) {
      const target = o.kind === "open" ? Math.min(1, o.p / 0.82) : o.p;
      let cur = this.cur[o.kind];
      if (cur == null || !o.near) cur = target;
      else {
        cur += (target - cur) * k;
        if (Math.abs(target - cur) < 0.0004) cur = target; else moving = true;
      }
      this.cur[o.kind] = cur;
      o.val = cur;
    }

    /* ---- write phase ---- */
    for (const o of reads) {
      if (!o.near && this.last[o.kind] != null && Math.abs(this.last[o.kind] - o.val) < 0.02) continue;
      const v = o.val.toFixed(4);
      if (this.last[o.kind] !== v) {
        o.st.style.setProperty("--p", v);
        this.last[o.kind] = v;
      }
    }

    const scanP = this.cur.scan ?? 1;
    const detailP = this.cur.detail ?? 1;
    const manualP = this.cur.manual ?? 1;

    /* The clip only runs while its act is on screen. */
    if (this.detailVideo) {
      const near = reads.some((o) => o.kind === "detail" && o.near);
      if (near && this.detailVideo.paused) {
        this.activateDetailVideo();
        const played = this.detailVideo.play();
        if (played && played.catch) played.catch(() => {});
      } else if (!near && !this.detailVideo.paused) {
        this.detailVideo.pause();
      }
    }

    this.grow(this.cur.open ?? 1);
    this.walk(scanP);
    this.mark(this.launch, this.cur.open ?? 1);
    this.mark(this.tels, scanP);
    this.mark(this.msteps, manualP);
    this.mark(this.joins, this.cur.join ?? 1);

    for (const dot of this.mdots || []) {
      const on = manualP >= parseFloat(dot.dataset.at || "0");
      if (this.marks.get(dot) === on) continue;
      this.marks.set(dot, on);
      dot.style.background = on ? ACCENT : IDLE;
    }

    if (this.mcard && this.cardScale) {
      const y = this.cardY + (1 - Math.max(0, Math.min(1, manualP))) * 14;
      this.mcard.style.transform =
        `translateY(${y.toFixed(1)}px) scale(${this.cardScale.toFixed(3)})`;
    }

    this.text(this.mnum, String(Math.max(1, Math.min(6, Math.ceil(manualP / 0.16) || 1))));
    this.text(this.mhours, String(Math.max(1, Math.min(3, Math.round(manualP * 3))) || 1));
    /* detailP is read above so the video check and the CSS variable stay in step. */
    void detailP;

    if (moving) this.raf = requestAnimationFrame(this.frame);
    else this.running = false;
  }

  /* Hero: the framed room opens out to full bleed on a pure transform. */
  grow(p) {
    if (!this.heroFrame || !this.motion) return;
    const t = Math.max(0, Math.min(1, p));
    const w = window.innerWidth;
    const h = window.innerHeight;
    const boxW = w * 0.52;
    const boxH = w * 0.3467;
    const full = Math.max(w / boxW, h / boxH);
    const sc = 1 + (full - 1) * t;
    this.heroFrame.style.transform = `scale(${sc.toFixed(4)})`;
    this.heroFrame.style.borderRadius = `${((14 * (1 - t)) / sc).toFixed(2)}px`;
    if (this.lastShadow !== (t > 0.55)) {
      this.lastShadow = t > 0.55;
      this.heroFrame.style.boxShadow = t > 0.55 ? "none" : "0 40px 90px rgba(0, 0, 0, .55)";
    }
  }

  /* Eight beats around the room: the phone repositions, the room re-frames to the
     same spot, and the read-out follows — one continuous first-person tour. */
  walk(p) {
    if (!this.motion || !this.phone) return;
    const t = Math.max(0, Math.min(1, p));
    const last = BEATS.length - 1;
    const pos = t * last;
    let i = Math.min(last - 1, Math.floor(pos));
    if (t >= 1) i = last - 1;
    const raw = Math.max(0, Math.min(1, pos - i));
    const k = raw * raw * (3 - 2 * raw);
    const a = BEATS[i];
    const b = BEATS[i + 1];
    const mix = (u, v) => u + (v - u) * k;
    const vw = window.innerWidth / 100;
    const vhUnit = window.innerHeight / 100;
    const w = window.innerWidth;
    const h = window.innerHeight;

    /* --- phone: position, aim, distance --- */
    const px = mix(a.ph.x, b.ph.x) * vw;
    const py = mix(a.ph.y, b.ph.y) * vhUnit;
    const yaw = mix(a.ph.yaw, b.ph.yaw);
    const roll = mix(a.ph.roll, b.ph.roll);
    const psc = mix(a.ph.s, b.ph.s);
    const bodySway = Math.sin(t * Math.PI * 2.2);
    this.phone.style.transform =
      `translate3d(${px.toFixed(1)}px, ${py.toFixed(1)}px, 0) ` +
      `rotateY(${yaw.toFixed(2)}deg) rotateZ(${roll.toFixed(2)}deg) scale(${psc.toFixed(3)})`;

    /* --- room: re-frames onto the same spot the phone is aimed at --- */
    const rs = mix(a.room.s, b.room.s);
    const rx = (mix(a.room.x, b.room.x) / 100) * w * 0.34 - px * 0.42 + bodySway * 0.5 * vw;
    const ry = (mix(a.room.y, b.room.y) / 100) * h * 0.34 - py * 0.36;
    if (this.room) {
      this.room.style.transform =
        `translate3d(${rx.toFixed(1)}px, ${ry.toFixed(1)}px, 0) ` +
        `rotateY(${(-yaw * 0.4).toFixed(2)}deg) rotateZ(${(-roll * 0.45).toFixed(2)}deg) scale(${rs.toFixed(3)})`;
    }
    if (this.roomGrid) {
      this.roomGrid.style.transform =
        `translate3d(${(rx * 1.25).toFixed(1)}px, ${(ry * 1.2).toFixed(1)}px, 0) ` +
        `rotateY(${(-yaw * 0.6).toFixed(2)}deg) scale(${(rs * 1.02).toFixed(3)})`;
    }
    if (this.roomLight) {
      this.roomLight.style.transform =
        `translate3d(${((t * 0.7 - 0.05) * 100 * vw + px * 1.4).toFixed(1)}px, ` +
        `${((t * 0.36) * 100 * vhUnit + py * 1.1).toFixed(1)}px, 0)`;
    }

    /* --- the view through the lens: handheld, and pushed in on close beats --- */
    if (this.phoneView) {
      const pw = this.phone.clientWidth || 260;
      const ph = this.phone.clientHeight || 560;
      const bob = Math.sin(t * Math.PI * 5.2);
      this.phoneView.style.transform =
        `translate3d(${((-px * 0.05) + (bodySway * 0.05 + (t - 0.5) * 0.09) * pw).toFixed(1)}px, ` +
        `${((-py * 0.05) + (bob * 0.02 - (t - 0.5) * 0.05) * ph).toFixed(1)}px, 0) ` +
        `rotateY(${(-yaw * 0.85 + bodySway * 2).toFixed(2)}deg) ` +
        `rotateZ(${(-roll * 1.4 + bob * 0.8).toFixed(2)}deg) ` +
        `scale(${(1.12 + (rs - 1.05) * 0.5).toFixed(3)})`;
    }

    /* --- scan line: one unhurried pass per beat --- */
    if (this.scanline) {
      const eased = raw * raw * (3 - 2 * raw);
      this.scanline.style.transform =
        `translateY(${(eased * 0.62 * (this.phone.clientHeight || 560)).toFixed(1)}px)`;
      this.scanline.style.opacity = (0.3 + 0.7 * Math.sin(Math.PI * raw)).toFixed(2);
    }

    /* --- read-out: only touched when the beat actually changes --- */
    const shown = raw > 0.5 ? i + 1 : i;
    if (this.beatIdx !== shown) {
      this.beatIdx = shown;
      const bt = BEATS[shown];
      for (const img of this.angles || []) {
        img.style.opacity = Number(img.dataset.angle) === bt.ang ? "1" : "0";
      }
      if (this.phoneView) {
        const src = `/landing/angle-${ANGLE_FILE[bt.ang]}.png`;
        if (!this.phoneView.getAttribute("src").endsWith(src)) this.phoneView.setAttribute("src", src);
      }
      this.swap(this.beatTitle, bt.title);
      this.swap(this.beatLabel, bt.label);
      this.text(this.beatItems, String(bt.items));
      this.text(this.beatRoom, bt.name);
      if (this.beatBox) {
        if (bt.box) {
          this.beatBox.style.left = `${bt.box[0]}%`;
          this.beatBox.style.top = `${bt.box[1]}%`;
          this.beatBox.style.width = `${bt.box[2]}%`;
          this.beatBox.style.height = `${bt.box[3]}%`;
          this.beatBox.style.opacity = ".9";
        } else {
          this.beatBox.style.opacity = "0";
        }
      }
    }

    this.text(this.views, String(Math.min(4, Math.floor(t / 0.22))));
    this.text(this.status, t > 0.9 ? "Room understood" : (t > 0.62 ? "Preparing the scope…" : "Checking this view…"));
  }

  /* Reveal anything past its data-at mark. The movement itself is in the CSS. */
  mark(list, base) {
    for (const el of list || []) {
      const on = base >= parseFloat(el.dataset.at || "0");
      if (this.marks.get(el) === on) continue;
      this.marks.set(el, on);
      el.classList.toggle("is-on", on);
    }
  }

  /* Cross-fade a label rather than snapping it, so beat changes read as one move. */
  swap(el, value) {
    if (!el || el.textContent === value) return;
    el.style.opacity = "0";
    clearTimeout(el.__swap);
    el.__swap = setTimeout(() => {
      el.textContent = value;
      el.style.opacity = "1";
    }, 200);
  }

  text(el, value) {
    if (el && el.textContent !== value) el.textContent = value;
  }
}

const root = document.querySelector("[data-ci-root]");
if (root) new Cinematic(root).setup();
