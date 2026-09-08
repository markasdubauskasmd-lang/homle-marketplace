# Homlle — design project handoff

Design work for **Homlle**, a UK home-services marketplace connecting Landlords/clients
with self-employed Cleaners. Source repo: `markasdubauskasmd-lang/homle-marketplace`
(branch `main`). This project holds **design files**, not production code — see
"How this relates to the repo" below.

---

## Read these first

| File | What it is |
| --- | --- |
| `github.md` | **The most important file.** Running record of everything read from the repo: the booking state machine, data contracts, exact source strings, and hard-won constraints. Read before changing anything. |
| `homlle-booking.js` | The shared booking model — the seam between the Cleaner and Landlord dashboards. |
| `Cleaner Dashboard Prototype.dc.html` | The main working prototype (desktop + mobile). |

---

## Design files

All `.dc.html` files are **Design Components**: self-contained HTML that opens
directly in a browser. Structure is `<x-dc>` template markup + a
`class Component extends DCLogic` logic class in a `<script type="text/x-dc">`
tag. Styling is inline only (no stylesheets, no CSS classes). `support.js` is the
runtime that renders them — do not edit it.

| File | Contents |
| --- | --- |
| `Cleaner Dashboard Prototype.dc.html` | 7 hash-routed screens: Activity, Jobs Map, Messages, Earnings, Reviews (+Performance tab), Profile, Job. Includes the live-job screen (journey, 18-task checklist, photo capture, finish gate), offer accept/decline with expiry countdown, and incident reporting. Mobile layout renders from the same file below the desktop one. |
| `Cleaner Dashboard Options.dc.html` | 5 design directions. Turn 2: `2a` Ledger (typographic, top bar, dense, table-led) and `2b` Day view (photo-led, bottom tabs, roomy, red carries the page). Turn 1: `1a`/`1b`/`1c`. **No direction picked yet.** |
| `Onboarding Home.dc.html` | Cleaner onboarding: intro screen + 14 hash-routed step pages, all in the carded pattern. |
| `Onboarding Mobile.dc.html` | Three phone screens for onboarding (welcome, a step, all 14 steps). |
| `Live Check.dc.html` | The onboarding page rendered in browser chrome at 1920×1080, 1512×982 and 1280×800, to show where a fixed canvas clips. |
| `Top Text Options.dc.html` | Four headline options (`1a`–`1d`) for the onboarding page. **Unchosen.** |
| `Right Column Options.dc.html` | Right-column variants for the onboarding page. `1b` (Counter) was chosen and is live. |
| `jobs-map.html` | Real Leaflet map, OpenStreetMap tiles, greyscaled. **Must stay plain HTML in an iframe** — a Design Component confines scripts to `<helmet>`, which races the map container and breaks Leaflet. |

Supporting files: `homlle-booking.js` (shared model), `image-slot.js`,
`browser-window.jsx`, `ios-frame.jsx` (frames/placeholders), `assets/` (artwork
cut from supplied renders), `public/` (a few files copied from the repo),
`dist/` (CSP-safe export attempts), `uploads/` (user-supplied references),
`_ds/` (the Modernist design system this project is bound to).

---

## The architecture that matters

**The Cleaner and Landlord dashboards are two views of ONE booking record**, joined
by `bookingId` and told apart by `participantRole`. The repo already works this
way — `bookingSummaryBuckets(bookings, role)`,
`bookingSummaryMoneyBoundary(booking, role)` etc. all take a role parameter.

`homlle-booking.js` is that seam, extracted so both dashboards consume one source.
Every export mirrors a signature already shipping in the repo:

- `public/booking-summary-model.js` — statuses, buckets, actions, money wording
- `public/landlord-dashboard-model.js` — request statuses, task/room parsing
- `public/active-job-model.js` — the live job: stages, actions, photos, disputes

**Going live is an import change, not a rewrite:** drop `mockBookings()` for
`list_my_booking_summaries` and re-point the pure functions at the repo modules.

### Booking status machine (do not invent stages)

```
pending-cleaner-acceptance → confirmed → cleaner-en-route → cleaner-arrived
  → cleaning-in-progress → awaiting-review → completed | cancelled | disputed
```

Two things this corrects about naive designs:
1. "Complete job" does **not** mean completed — it means `awaiting-review`. The
   Landlord confirms, then it's `completed`.
2. Completed value is explicitly **not proof of transfer**. The exact per-status
   money wording is prescribed by `bookingSummaryMoneyBoundary` and must be
   quoted, never paraphrased.

### Two label maps, not interchangeable

`activeJobStatusLabels` (the job screen) says **"Cleaning finished"** for
`awaiting-review`; `bookingSummaryStatusLabels` (the booking lists) says
**"Awaiting review"**. Use whichever owns the surface.

---

## How this relates to the repo

Design files here are **not** in the repo. One production export was uploaded to
`public/` (`onboarding-preview-v3.html` + `.css`) and serves at homlle.com.

Two constraints learned the hard way:

- **The site's CSP blocks inline styles and CDN scripts.** A production page needs
  classes + an external stylesheet, no unpkg.
- **`cleaner-registration.html` and the `cleaner-*` set are frozen** — CI tests
  assert their internals. Editing them breaks the build. Uploads must use **new
  filenames**, never overwrite (two attempts served stale bytes before a rename
  worked).

---

## Open work

1. **Pick a dashboard direction** from `Cleaner Dashboard Options.dc.html` (`1a`–`2b`).
2. **Rewire Activity's 8 invented tiles** onto the 9 real values
   `cleanerDashboardSummary()` returns — notably `committedJobValuePence`
   (accepted but not completed), which no current design shows.
3. **Missing states:** expired invitation, the accept-a-cancelled-job race
   (`cleanerInvitationDecisionState` → `"different-outcome"`), the
   pricing/geocoding capability gates, and `disputed` — which has no screen.
4. **Broken joins:** accepting an offer always opens the same LS6 job and doesn't
   update Activity; "Contact the customer" dead-ends at an inert composer;
   incidents have no history.
5. **Still absent:** editable availability, real Earnings (per-job breakdown,
   next payout, statements for Self Assessment), document-expiry warnings,
   recurring clients, and a zero state for a brand-new cleaner.
6. **Strip the provenance notes before shipping.** The dashed "Authored, not
   product" / "From source" notes exist to separate real product strings from
   proposals. They're review scaffolding — decide build-time strip vs a flag.
7. **Simplify** (from the audit): delete the Performance tab (it says "Nothing is
   measured here yet"), cut 5 of 8 status tiles as duplicates, drop the empty
   rating breakdown, "Auto-translate off", one of two Stripe buttons.

---

## Working rules (each one cost several review cycles)

- **Read the owning `*-model.js` before designing a screen.** The product's own
  labels and rules are usually already there. Three review rounds went on
  provenance drift because the live-job screen was built before reading
  `active-job-model.js`, which already contained the finish gate.
- **Call the model, never restate it.** A literal that duplicates a module export
  is a latent drift bug even while it matches.
- **De-emphasised ink floor is `rgba(...,0.72)`.** 0.55/0.6 composites under
  4.5:1. Exempt: 26px+/weight-800 display numerals and disabled controls.
- **Composite translucent fills before measuring contrast.** An 18% white pill on
  brand red is 4.01:1 and fails.
- **Table column widths go on the header cells** — the DC template parser drops
  `<colgroup>`/`<col>` entirely.
- **Use `width: min(Npx, 100%)` with `min-width: 0`**, not fixed px, or wrappers
  cause document overflow.
- **String edits fail silently on curly vs straight quotes.** Key on short
  unquoted fragments and verify the old string is gone.
- **Load the page after editing.** A duplicate `const` in the logic class is a
  SyntaxError that blanks every screen with no other symptom.

---

## Design system

Bound to **Modernist** (`_ds/modernist-*/`): flat, architectural, Archivo
throughout, near-mono red (`#ec3013`) on a light ground (`#f3f2f2`), strong 2px
rules, photography in pure black and white via `.grayscale`.

The Homlle work departs from it in two deliberate ways, matching the live
product: **rounded corners** (the shell is 29px, cards 22px) where Modernist
specifies 0, and **red as a large gradient field** on the rail and header.
