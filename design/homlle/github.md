repo: markasdubauskasmd-lang/homle-marketplace
branch: main
path: public/

## Last sync

date: 2026-09-08T12:30:00Z

### Updated in this project

- All fourteen rail icons are now clickable: the design is hash-routed (`#personal-details` … `#review-submit`), with the intro screen at `#home`.
- Built all fourteen onboarding step screens — real headings, section legends and fields transcribed from the repo's registration, documents and contracts pages.
- Step pages use the product's own step shell: white canvas, vertical red rail, "STEP n OF 14" topbar with progress, Back / Save & continue footer.
- Rail shows the active step as the design's white indicator plus completion ticks, driven by the `stepsRecorded` tweak.
- Banking, Document centre and Academy screens re-grounded: no invented bank-number fields, real document categories and status vocabulary, the real featured course, catalogue counts and three required modules.
- Insurance cover types, Cleaner specialisms, equipment/products/transport options and all thirteen contracts now use the repo's own option sets and status wording.
- Home screen: shortened the label to HOMLLE · ONBOARDING (22px, light grey — dark grey on the red field measured 1.65:1 and was illegible), and added a four-item WHY HOMLLE benefits block.
- Replaced the artwork with a clean cutout of the user's original full-resolution render, so the cast is genuinely sharp instead of an upscaled screenshot crop.

## Screen map

| Project screen | Built from |
| --- | --- |
| Onboarding Home.dc.html `#home` | public/cleaner-registration.html (intro hero), public/cleaner-onboarding-redesign.css (frame, rail, gradients, artwork placement) |
| `#personal-details` `#business-details` `#banking` `#identity-verification` `#right-to-work` `#background-checks` `#work-areas` `#review-submit` | public/cleaner-registration.html (per-step cards, legends and fields) |
| `#experience` | public/cleaner-registration.html (specialism list, legend, guidance), public/cleaner-experience.js |
| `#insurance` | public/cleaner-registration.html (`coverTypes`, policy fields), public/cleaner-insurance.js (cover-type table, supplier note) |
| `#equipment` | public/cleaner-equipment.js (`knownEquipment`, `knownProducts`, `transportModes`), public/cleaner-registration.html (transport labels) |
| `#documents` | public/cleaner-documents.html, public/cleaner-documents.js (`definitions` categories, status vocabulary) |
| `#contracts` | public/cleaner-contracts.html, public/cleaner-contracts.js (the thirteen agreements and their statuses) |
| `#training` | public/cleaner-training.html (featured course, catalogue counts, filter row), public/cleaner-training.js (the three active Required modules) |
| Rail order, icons, step titles | public/cleaner-onboarding-steps.js (`onboardingNav`, `onboardingIcons`), public/cleaner-sidebar.js |
| Live Check.dc.html | renders Onboarding Home at 1920×1080, 1512×982 and 1280×800 in browser chrome |
| public/homlle-onboarding-logo-white.png | copied verbatim from the repo |
| assets/homlle-team.png | cut out of the supplied screenshot; `homlle-onboarding-team-v5.png` is not committed to the repo |

## Sync history

- 2026-08-19T18:34:23Z — first import: built the onboarding introduction screen and the shell from `public/`.

## Working notes

- ARTWORK: `assets/team-src-native.png` (1061×934) is the editable master; `assets/homlle-team-hd.png` is the sharpened display copy. Cut from `uploads/exec-19111e25-8f1e-48db-83f6-472ce8f04122226d.png` — a de-backgrounded render whose transparency was flattened to a baked checkerboard, so the checker was keyed out rather than a room being segmented. Method: loose neutral flood from the border for the open background; enclosed patches classified by FLATNESS (the checker is exactly two flat tones — leg gap 22% flat vs mop strands 1.3%, which is what separates them); then three leftover white slivers from the upstream background removal and a white halo were cut, and the mop head recoloured charcoal. Verified: one connected component, 0 light px in the mop region.
- STANDING NOTE: the mop head is white in every source render and must be recoloured charcoal (the user asked twice). The component filter must run LAST — any repair pass after it re-seeds orphan islands.

- `Onboarding Home.dc.html` is the whole product: intro at `#home` plus fourteen hash-routed step screens. Tweaks: steps recorded, next step, show/hide "What you'll need".
- `Top Text Options.dc.html` holds four top-of-page headline options (1a current, 1b progress, 1c poster, 1d obstacle) — no pick made yet.
- `Live Check.dc.html` renders the home screen in browser chrome at 1920×1080, 1512×982 and 1280×800. The design is a fixed 1440×1024 canvas, so it clips on shorter windows — making it fluid (100vw/100vh like the product CSS) is the open next step.

- `assets/homlle-team-hd.png` is cut from the user's original full-resolution render (`uploads/exec-6388f0e3-52ee-4c32-9a90-f2553a24891c.png`), not from a screenshot. The repo carries no team artwork — only `homlle-onboarding-logo-white.png` — so that upload is the only high-res source. It is segmented off the room by region-growing, with the phone pinned and the sofa/plant/floor fragments cleared; kept at 1.5× (1490×1290) and shown at 670px for a 2.2× supersample.

## Session pause — 2026-08-20T16:44:00Z

Where things stand on `Onboarding Home.dc.html` (intro at `#home` + 14 hash-routed step screens):

- **Artwork**: `assets/homlle-team-hd.png`, cut from the user's checkerboard PNG (`uploads/pasted-1787239301104-0.png`). That file had NO alpha channel — the checker was baked in as pixels — so it was keyed by *flatness* (two flat tones) rather than colour, which separated cleanly where colour never could. Editable master: `assets/homlle-team-native.png`. Charcoal mop is re-applied on top; every source render ships it white, so any re-cut wipes it.
- **Backdrop**: `assets/backdrop-merged.png` — the user's living room, black and white per the design system, brightened to ~0.76 mean luminance, no overlay pattern (data lines were tried and removed at their request). Sits in an `image-slot` so a new photo can be dropped in.
- **Home screen**: label reads HOMLLE · ONBOARDING in light grey; four-item WHY HOMLLE benefits block; right column is the "Counter" card variant (1b) with a 14-tick meter.
- **Personal details** is the one step page restyled to the carded pattern (4 white cards, 22px radius, 3px border, numbered headers with REQUIRED/OPTIONAL pills). The other 13 still use the flat ruled layout.

### Gotchas worth remembering

- Never put a visible header in `<legend>` on a bordered card — the browser reserves a slot in the top border area and cuts it open, while DOM/computed values still read as correct. Use a visually-hidden legend plus a plain first-child div.
- The layout validator's "cut off 302px by its 78×14px clipping container" is the tick meter (78px of a 380px track = exactly 3 of 14 steps). Confirmed repeatedly. Not a defect.
- Repair passes on the artwork must run BEFORE the small-component filter, or they re-seed orphan islands the filter already cleared.

### Open threads

1. Restyle the remaining 13 step pages to the carded pattern (only Personal details is done).
2. Make the layout fluid — it is a fixed 1440×1024 canvas and clips on windows under ~1024px tall (see `Live Check.dc.html`).
3. `Top Text Options.dc.html` still holds four unchosen headline options (1a–1d).

### Carded step pages — 2026-08-26

All fourteen step screens now use the carded pattern from the Personal details reference: white cards on the light ground, 3px #2d2b2a border at 22px radius, numbered 01/02/03 headers with a one-line hint and a REQUIRED / OPTIONAL / READ / SOON / PREVIEW / TRACKER pill. 35 cards total.

- Form pages (Business, Banking, Identity, Right to work, DBS, Experience, Insurance, Equipment) kept their `<fieldset>` grouping — the visible header is a plain first-child div and the legend is visually hidden, so the top border stays closed.
- Content pages were re-wrapped: Work areas and Contracts became two side-by-side cards (grid gap replaces the old border-left divider), Document centre two, Academy three, Review one with the {{ done }}/{{ total }} counter moved into the card header.

## Push status

Write access is NOT available: the Claude Design Import app is read-only (403 on both branch creation and file commit; its authorization page states "read from your repository"). Uploads must be done by the user by hand — do not promise a push.

Render deliverable: `dist/homlle-onboarding.html` (2.3 MB, self-contained — all 15 screens, design-system CSS, image-slot runtime and every image inlined as data URIs; verified rendering standalone with no local refs). Rebuild it by inlining support.js + image-slot.js + the design-system stylesheet and swapping the three image refs for data URIs (embed the artwork's original PNG bytes — re-encoding at 1220px made it both larger and softer).

Upload path: drop the file into `public/` on main, then Render serves it at `/homlle-onboarding.html` (static site, publish directory `public`).

### Sync check — 2026-09-05

Tree `a6d20c41fae3`. The twelve `public/cleaner-*` onboarding files are unchanged in shape since the last sync; nothing new to pull, no screens needed rebuilding. (Commit sha unknown — the tool resolves a tree hash, not a commit.)

## Production build — dist/site/

A CSP-safe, no-framework build of the whole onboarding, made to drop into `public/` and replace the live registration page. Files: `cleaner-registration.html` (177KB), `homlle-onboarding.css` (33KB), `homlle-onboarding.js` (0.8KB), `homlle-onboarding-team.png`, `homlle-onboarding-room.jpg`, `homlle-onboarding-logo.png`.

Why it exists: the site enforces `script-src/style-src 'self'`, which blocked the DC runtime (it loads React from unpkg) AND every inline `style` attribute — the first upload rendered as raw unstyled markup with visible `{{ }}` holes. This build has no inline styles, no remote requests and no framework.

How it was made (repeatable — do NOT hand-rewrite it): a transformer reads `Onboarding Home.dc.html`, evals the `STEPS`/`ICONS` tables out of the logic class, expands `sc-if`/`sc-for` and every `{{ hole }}` once per route into 15 static `<section class="ho-screen">` blocks, then hashes each unique `style` attribute into a generated class (268 of them) and turns `style-hover`/`style-active`/`style-focus` into real `:hover`/`:active`/`:focus-visible` rules. Semantic hooks (`ho-stage`, `ho-shell`, `ho-rail`, `ho-main`, `ho-card`, `ho-abs`, `ho-grid`, `ho-art`) are added by matching known style signatures so the responsive layer has something to target.

- Routing: `homlle-onboarding.js` shows the section matching `location.hash` (default `home`) — a real file, so `script-src 'self'` is satisfied.
- Fit: the 1440x1024 canvas is scaled with `zoom` steps. Width steps come first, then height steps each guarded by a `min-width` so a short-and-narrow window takes the smaller scale. Without those guards there was 152px of horizontal overflow at ~920px wide.
- Mobile (<=900px): rail becomes a sticky scrolling top bar, `.ho-abs` unpins the absolutely-placed blocks into normal flow, grids collapse to one column, artwork hidden, 44px minimum hit targets, 16px inputs.
- Fonts: `@font-face` points at `vendor/fonts/archivo-wght-latin*.woff2`, already in the repo.
- Labelling: a post-pass gives every `.field` control a unique id (`f0`…) and sets `for` on its label — the generated markup emitted a bare label beside the control, so 53 of 117 fields had no accessible name and the label was not a hit target. Keep this step if the build is regenerated; verify with a count of controls lacking `for`/wrapper/`aria-label` (must be 0).
- Forms are static by the user's choice — fields render, nothing saves. `cleaner-registration.js` is NOT loaded.

## CI finding — cleaner-registration.html is NOT a standalone page

Commit 83daee4 (uploading the dist/site build over public/cleaner-registration.html) FAILED CI: "Unit, syntax and safety checks". Do not retry that approach.

The repo's tests assert the page's internals — replacing the file breaks ~18 assertions in `tests/booking-dashboard-ui.mjs` alone:

- The page must contain `class="hc-brand-mark" href="/cleaner/introduction"`.
- All 14 steps are REAL URLS served from this one file — `server.mjs` maps `"/cleaner/personal-details": "cleaner-registration.html"`, `"/cleaner/banking"`, `"/cleaner/work-areas"`, `"/cleaner/review-submit"`, `"/cleaner/congratulations"` and so on. `cleaner-registration.js` switches step on `location.pathname`, NOT on a hash.
- `public/cleaner-onboarding-steps.js` must keep exact `key/title/icon/sidebar/href` and `label/icon/step/href` tuples per step; tests string-match them.
- Removed steps must keep their redirects: `/cleaner/references` → `/cleaner/insurance`, `/cleaner/availability` → `/cleaner/jobs-map`, and `data-personal-step-key="availability"` must NOT appear in the page.
- `.cleaner-onboarding-introduction-page .hc-main-inner { display: none !important }` must exist in `cleaner-onboarding-redesign.css`.
- Other pages tests touch: `tests/design-system.mjs` (lists "cleaner-registration"), `tests/google-maps-integration.mjs`, `tests/home-entry-ui.mjs`, `tests/cleaner-dashboard-freeze.mjs`, `tests/workspace-dead-controls.mjs`, `tests/publication-safety.mjs`, `tests/retired-pages.mjs`.

Correct integration shape: port the DESIGN into the existing page — keep the `hc-*` hooks, the path-based routing and `cleaner-registration.js`, and change only markup and CSS. The hash-routed `dist/site/` build remains valid ONLY as an off-site preview (e.g. Netlify drop), never as a replacement for this file.

User was told to revert commit 83daee4 via the GitHub commit page.

### Commit forensics — which commit to revert

- `7bf0fc45e7a1f20c410d9f97520f76cdc39e19a0` (2026-09-05T22:33:12Z, "Add files via upload") is THE commit that replaced public/cleaner-registration.html with the hash-routed dist build and added the 5 companion files. This is the one to revert.
- `83daee494992` (12h later, same message) changed **0 files** — the user re-uploaded byte-identical content, so it is an empty commit. Reverting it does nothing. Do not chase it.
- Last good version of the page: `37018e9c856119a1d8bb071fd6b4caa3097a70d4` (2026-08-18, "Stop showing the access interstitial on the onboarding tabs").
- Live page confirmed byte-identical to `dist/site/cleaner-registration.html` (183,061 bytes both sides), so main is serving the broken build.

Write access: `github__create_or_update_file` and `github__create_branch` both return 403 "Resource not accessible by integration" — the installation is read-only. All uploads must be done by the user until Contents is set to Read and write.

### FREEZE — Cleaner Dashboard files cannot be changed

`tests/cleaner-dashboard-freeze.mjs` pins a protected set byte-for-byte:

- Set = every `public/cleaner-*` file + `public/homle-cleaner.css` + every `src/marketplace/cleaner-*` + 16 listed shared deps. `expectedFileCount = 89`, `expectedDigest = 88e64c24…`.
- `public/cleaner-registration.html` IS in this set. Any edit fails CI. The test text says not to refresh the digest "unless the user explicitly replaces the no-change objective".
- A NEW file named `cleaner-*.css` would also fail — it changes the count 89 → 90.
- Text files are CRLF-normalised before hashing, so line-ending churn from a browser download/upload round trip is harmless. PNGs are byte-exact.
- `homlle-onboarding-*` files (my 5 uploads) are NOT in the protected set — they don't start with `cleaner-`, so leaving them in place breaks nothing.

Consequence: the carded redesign CANNOT be applied to `cleaner-registration.html` while the freeze stands. Options put to the user: (1) lift the freeze and refresh the digest as part of the redesign, (2) ship as a new page outside the frozen namespace, e.g. `public/onboarding-preview.html` (recommended), (3) keep as a design reference for a developer.

Site state: user restored the original page (commit ec40274, 104,875 bytes vs original 104,845 — CRLF only, digest-safe). Live `/cleaner/*` routes work again.

## Session pause — mobile preview, 2026-09-06

### Live now
`public/onboarding-preview-v3.html` + `onboarding-preview-v3.css` are committed and serving correctly at homlle.com. They reuse the already-committed `homlle-onboarding.js`, `-team.png`, `-room.jpg`, `-logo*.png`. Nothing in the frozen `cleaner-*` set was touched, so CI is unaffected.

Upload lesson: two earlier attempts served stale bytes (page had `{{ }}` placeholders and a title matching neither build). Fresh, uniquely-named files fixed it. Any future upload should use a NEW filename, never overwrite, so no cache or stale download can interfere.

### Mobile preview — `Onboarding Mobile.dc.html`
Three iPhone frames (design preview only, NOT in the repo):
1. **Welcome** — rail becomes a 44px header with the real logo; full-width stacked CTAs; counter card with the 14-segment tick meter; whole cast `object-fit: contain` standing on the bottom edge.
2. **A step (Personal details)** — all four cards from the repo fieldsets: 01 YOUR DETAILS (10 fields), 02 EMERGENCY CONTACT (Name/Number/Relationship), 03 ADDRESS (Postcode–Country + 5-year toggle), 04 PROFILE PHOTO. Pinned Back / Save & continue footer.
3. **All 14 steps** — what replaces the rail. Labels, order and SVG icon paths lifted verbatim from `onboardingNav` / `onboardingIcons`.

### Constraints learned the hard way (apply to any further mobile work)
- `IOSDevice` reserves **62px top** (status bar) and **~34px bottom** (home indicator) — both need explicit insets; content passing under the indicator is fine only for full-bleed imagery.
- `overflow-y: auto` paints a 15px desktop scrollbar inside the phone. Suppressed by the helmet rule on `[data-phone-scroll]` — inline styles cannot express `::-webkit-scrollbar`.
- The tappable box for the DS segmented control is `.seg-opt`, not its radio (radios are visually hidden, height 0) — it needs its own 44px minimum, set in the helmet.
- Alpha-muted ink from the desktop (0.55–0.62) fails 4.5:1 at mobile 10–12px; use 0.72. Display numerals need 0.5 to clear 3:1.
- Accepted, not defects: white on brand red measures 4.41:1 (fixing it would mean changing Homlle's red), and the white ✓ on the `#ee352c` tick badge is a 12px marker glyph beside a legible label.

### Next steps when we resume
1. Decide whether the mobile design ships as CSS media queries added to `onboarding-preview-v3.css` (safe — outside the frozen set) or as a separate mobile page.
2. Remaining desktop threads: pick a headline from `Top Text Options.dc.html` (1a–1d, still unchosen); the desktop page is a fixed 1440×1024 canvas that clips under ~1024px height.

## Cleaner dashboard redesign — options put to the user, 2026-09-06

`Cleaner Dashboard Options.dc.html` holds three directions, each with a paired iPhone frame: **1a Week board** (closest to the live page, restyled), **1b Next job first** (one job fills the screen; mobile-native), **1c Poster** (the onboarding red field carried through; strongest at zero). Awaiting the user's pick.

Grounded from the repo (read this turn):
- Live dashboard strings now taken from SOURCE (`public/cleaner-dashboard.html`, `public/cleaner-dashboard.js`, cross-checked against `public/cleaner-schedule.html`), not the screenshot: h2 `Activity schedule`; sub "See selected work by week, then review every clean's price, area, type and property images below."; tile labels `VALUE THIS WEEK` / sub "agreed Cleaner pay", `NEXT WEEK` / "confirmed so far", `HOURS BOOKED`, `JOBS` / "<n> awaiting your reply"; section kicker `SELECTED WORK` over h3 `Upcoming cleans`; alert copy "<n> offers awaiting your reply" + "Offers close automatically when the window ends."; classes `hc-page-title`, `hc-page-sub`, `hc-tile-label`, `hc-tile-sub`, `hc-schedule-time-off-kicker`. Preview-data precedent: `cleaner-schedule.js` — "these example cleans show how selected work will appear. They are not bookings."
- Screenshot cross-check of `/cleaner/dashboard`: Activity schedule, week nav, four stat cards (Value this week / Next week / Hours booked / Jobs awaiting reply), week grid Mon–Sun, "Upcoming cleans", and the rail (Activity, Jobs Map, Messages, Earnings, Performance + Account group).
- `public/active-job-model.js` — ratings are overall + quality / punctuality / communication / professionalism (1–5), and **only a moderation-approved review affects the public rating**. The designs therefore show "no rating until your first approved review" rather than inventing stars.
- `public/booking-summary-model.js` — `averageRating` is 0 when there are no reviews.
- Badges are grounded in onboarding state (DBS verified, ID verified, Insurance pending), not invented gamification.

CONSTRAINT: `public/cleaner-dashboard.html` / `.js` are inside the freeze digest set (every `public/cleaner-*` file). The approved design must ship as a NEW page outside that namespace — same route as the onboarding preview — never as an edit to the dashboard files.

### Dashboard options — grounding fixes applied 2026-09-06T12:57Z

- Real headings/labels/sub-copy swapped in (see above); the invented "Morning, Amara." and "AWAITING YOU" removed.
- `onboardingIcons` paths now verbatim in all three options (pin, chat, spark and user had been hand-truncated differently per option).
- Every rail carries the same five destinations (Activity, Jobs Map, Messages, Earnings, Performance) plus a foot cluster using `accountNav`'s exact labels — My Profile, Settings, Logout — and a Notifications bell top-right as on the live page. The remaining four ACCOUNT destinations are stated as out of scope in the caption.
- Stat tiles are CSS grids with a fixed 32px label track, so a wrapping label cannot push its figure off the shared baseline.

## Dashboard prototype — clickable, 2026-09-06

`Cleaner Dashboard Prototype.dc.html` — six hash-routed pages off a working rail: `#activity`, `#jobs-map`, `#messages`, `#earnings`, `#performance`, `#profile`. Real photographs in place (assets/room-photo.png, assets/backdrop-merged.png); `image-slot` kept only for the profile photo.

Real strings read from source this turn:
- `public/cleaner-payouts.html` (read in full) — eyebrow "Cleaner payouts", h1 "Get paid without sharing bank details with Homle", Stripe copy, "Set up payouts securely", and the protected note ("never enter bank details anywhere on Homle… must be on connect.stripe.com… no real payment or payout will be made"). NOTE: this page has NO earnings chart — it is a Stripe setup flow. An invented six-week bar chart was removed.
- `public/cleaner-jobs-map.html` — h1 "Jobs near you", sub "Explore available jobs by area, then review the full clean details before deciding.", h2 "Available jobs".
- `public/cleaner-performance.html` — h1 "Performance", `hc-rank-tier` "Not ranked yet", h2 "Reviews & ratings" + sub "Clients rate every completed job. Ratings drive how often you're offered work.", tiles OVERALL RATING / COMPLETED JOBS / PUBLIC LISTING / AWAITING MODERATION, h3 "Rating breakdown", h3 "Earn your first 5★".
- `public/cleaner-public-profile.html` — h1 "Your public profile", sub "Exactly what clients see when Homle offers them your profile. It updates live as you edit your registration."
- `public/cleaner-dashboard.html` further tiles: PENDING OFFERS, CURRENT JOBS, COMPLETED, RATING, COMPLETED JOB VALUE, CONFIRMED JOB VALUE, AVAILABILITY, GETTING PAID; h3s "Pending requests", "Active and upcoming jobs", "Holiday mode & time off"; h2 "Complete your setup. Get ready for suitable jobs."
- `public/cleaner-notifications.html` — h2s "Recent", "Channels", "Push notification settings". `public/cleaner-help-centre.html` — h2 "Talk to us".

Honesty devices: an EXAMPLE DATA pill in the page header wherever sample content is shown, and NOT IN THIS PASS beside the six ACCOUNT destinations whose real pages exist but are unbuilt here (`cleaner-notifications`, `cleaner-help-centre`, `cleaner-support-tickets`, `cleaner-incident-reports`, `cleaner-disputes`, `cleaner-settings`).

`public/cleaner-messages.html` read in full 2026-09-06T13:34Z — Messages page now grounded: h1 "Messages", sub "Chat with clients and the Homle team. Numbers stay private — everything goes through the app."; the "🌐 Auto-translate off" pill (title "Automatic translation is not connected in this preview"); section label "Private booking conversations"; chat head "Select a conversation" / "Private booking messages" with a "View clean →" link; three quick replies verbatim ("On my way", "Running 10 minutes late — sorry!", "All done — photos are in the app"); composer placeholder "Write a message…" with an "↑" submit; footer note "Messages are monitored for safety · keep bookings and payment on Homle."; offline note "You are offline. Existing messages remain visible, but sending needs a connection."

Also learned from that file: the REAL cleaner rail is seven items — Activity, My Schedule, Jobs Map, Messages, Earnings (`/cleaner/payouts`, hidden until payouts exist), Reviews (`/cleaner/reviews`), Onboarding — plus a "Continue setup ↗" CTA and collapsible ONBOARDING / ACCOUNT groups. The prototype's rail is five; My Schedule and Reviews are absent.

`public/cleaner-reviews.html` read in full 2026-09-06T13:41Z. Reviews is its OWN page and owns the rating tiles (they are NOT Performance's): OVERALL RATING / "No approved reviews yet", COMPLETED JOBS / "verified marketplace jobs", PUBLIC LISTING / "what clients can see", AWAITING MODERATION / "held until Homle approves"; empty state "No client reviews yet" + "Reviews appear here after your first completed job. A client can only review a booking they confirmed as finished."; panels h4 "Rating breakdown" and h4 "Earn your first 5★" with the tip "Arrive on time · follow the client's checklist · send finish photos · reply to messages quickly."; head CTA "View public profile ↗" → /cleaner/profile/preview.

**KEY PRODUCT TRUTH from that file's own comments — do not design around it:**
- Jobs Map and Performance "are in the design's sidebar but have nothing behind them: MAP_PROVIDER is none (and the design's own map page needs Leaflet plus OpenStreetMap tiles, which the CSP blocks), and Homle records no on-time, response-rate or rebook metrics. They keep the design's position and icon but are inert and marked disabled rather than shipped as links to nowhere."
- Response rate, on-time arrival, rebook rate and verified reference quotes are all in the design but recorded nowhere — "left out rather than shown with invented figures".
- The ACCOUNT group in this file is Availability, Messages, Public profile, Public directory (hidden) — different from cleaner-messages.html's My Profile / Notifications.

Rail order from source: Activity, My Schedule, Jobs Map, Messages, Earnings, **Reviews, Performance**, Onboarding, then "Continue setup ↗".

STILL UNREAD (page bodies authored, disclosed in-page as "Authored, not product"): `cleaner-jobs-map.html` (map panel, service radius, travel card, per-offer distances), `cleaner-public-profile.html` (name/areas/experience line, badge row, `hc-pp-*` block), `cleaner-performance.html` beyond its headings, `cleaner-schedule.html` (the holiday-mode toggle), and all the `.js` for those pages.

## Two step lists — read from source 2026-09-06

`public/cleaner-onboarding-steps.js` (read in full at commit 926fb2de86a2) carries THREE lists that keep getting confused. Check which one a screen needs before editing labels:

- `onboardingSteps` — the 14 PROGRESS chips. Includes `{key:"skills", title:"Skills", sidebar:false}`, "Training & certificates" and "Compliance & declarations". Order: personal, business, banking, identity, rtw, dbs, experience, insurance, equipment, areas, skills, training, compliance, review. This is what the prototype's #onboarding step list uses.
- `onboardingNav` — the 14 SIDEBAR items, shorter labels ("Banking", "Contracts"), adds Documents, and its order puts Work Areas BEFORE Skills and Experience.
- `accountNav` — 8 entries: My Profile, Notifications (notificationHook), Help Centre, Support Tickets, Report an Incident, My Disputes, Settings, Logout (`action: "logout"`). Settings and Notifications ARE real destinations. An earlier note in this file described a different file's ACCOUNT group and wrongly implied Settings did not exist.

`Onboarding Home.dc.html`'s own `STEPS` array uses AUTHORED labels for some of these ("Document centre", "Homlle Academy", "Contracts & agreements") — do not treat it as the source of truth for the dashboard.

Also from `public/cleaner-sidebar.js` line 247: Logout renders as `<button data-account-sign-out data-sign-out-destination="/login?intent=work">`, every other account entry as `<a>`. The prototype now matches this.

## Session pause — cleaner dashboard, 2026-09-08

Design files only. Nothing from this dashboard work has been committed to the repo.

### Files
- `Cleaner Dashboard Prototype.dc.html` — the working prototype. Desktop shell plus a live mobile layout below it, both from one source. Routes: activity, jobs-map, messages, earnings, reviews (+performance tab), profile, job.
- `Cleaner Dashboard Options.dc.html` — five directions. Turn 2: 2a Ledger (typographic, top bar, dense, table-led, red as accent only), 2b Day view (photo-led, bottom tabs, roomy, red carries the page). Turn 1: 1a/1b/1c below. No pick made yet.
- `jobs-map.html` — real Leaflet map, OSM tiles, greyscaled per the design system. MUST be a plain HTML file in an iframe: a DC confines scripts to `<helmet>`, which races the map container and breaks Leaflet.

### Built this session
- **Offer accept/decline** under Jobs near you: scope, pay breakdown (client pays → fee → your pay), travel from base, live expiry countdown, decline with reason.
- **Incident reporting** on the live job and Activity, with the 8 `REPORT_CATEGORIES` plus Other → free text, and Contact the customer.
- **Clickable week days** linking to the map, with previous/next week paging (3 weeks of example data).
- **Working live job screen**: 5-stage journey with timestamps, 18 tasks across 5 rooms, before/after photo capture, and a 3-condition finish gate. The checklist locks once complete so submitted evidence cannot be edited.

### Known gaps (from the audit — worth reading before the next pass)
1. Accepting an offer opens the same LS6 job whichever offer you took — the job screen is not parameterised.
2. Accepting changes nothing else: Activity still shows 2 offers / £68 / no bookings.
3. Contact the customer dead-ends — the Messages composer is inert.
4. Incidents have no history; My Disputes is inert.
5. Availability is still a dead tile; Earnings still has no money in it (no per-job breakdown, next payout, or statements); no document-expiry warnings; no recurring clients; notifications bell goes to Profile.
6. Cut list: Performance tab, 5 of 8 status tiles, the empty rating breakdown, "Auto-translate off", one of two Stripe buttons, "Edit areas" on the map.
7. **The dashed provenance notes must be stripped before this ships** — decide build-time strip vs flag.

### Constraints learned (apply to any further work here)
- De-emphasised ink floor is 0.72 alpha. 0.55/0.6 composites under 4.5:1. Exempt: 26px+/weight-800 display numerals (0.5 is fine at 3:1) and genuinely disabled controls.
- Never measure white-on-red against the gradient stops alone — composite translucent pills first. An 18% white pill on red is 4.01:1 and fails.
- Table column widths must go on the header cells: the DC template parser drops `<colgroup>`/`<col>` entirely.
- Fixed-px option wrappers cause document overflow; use `width: min(Npx, 100%)` with `min-width: 0`.
- Map pins: at 15-mile zoom LS1/LS2/LS6 are ~16px apart, so no label arrangement separates them — one cluster marker plus a fixed legend. Pixel anchors tuned at full width do not survive the 339px card.
- `str_replace`-style edits fail silently on curly vs straight quotes. Key on short unquoted fragments and verify the old string is gone.

### Todos still open
5. Build a CSP-safe production page (classes + external CSS, no CDN, no inline styles) — the site's CSP blocks inline styles and unpkg.
6. Add fluid + mobile layout to that production page.
7. Package files for `public/` upload — and remember: always a NEW filename, never overwrite, or stale bytes get served.

## The cleaner/landlord seam — read from source 2026-09-08

Read `public/booking-summary-model.js` and `public/landlord-dashboard-model.js` at commit 4a4518b82e6a. The client side is already built and large: `landlord-dashboard.js` 276KB, `landlord-dashboard-v2.css` 145KB, `landlord-dashboard.html` 85KB, plus landlord-journey / -checkout / -help / -messages and customer-* files.

**The two dashboards are one record, two roles.** `bookingSummaryBuckets(bookings, role)`, `bookingSummaryPrimaryAction(booking, role)` and `bookingSummaryMoneyBoundary(booking, role)` all take `participantRole` ("cleaner" | "landlord"). Join key is `bookingId`; `liveBookingForRequest` joins a booking to its request by `cleaningRequestId` or, when that is withheld, by the frozen time window.

**Booking statuses (the real machine — use these, do not invent stages):**
pending-cleaner-acceptance → confirmed → cleaner-en-route → cleaner-arrived → cleaning-in-progress → awaiting-review → completed | cancelled | disputed ("Under review").
Cleaner buckets: pending (invitation open), upcoming (confirmed), active (en-route/arrived/in-progress), history (awaiting-review, completed, cancelled, disputed, expired invitations).

**Landlord request statuses:** draft, searching-for-cleaner, cleaner-invited, pending-cleaner-acceptance, matched, cancelled.

**The real cleaner dashboard tile contract** — `cleanerDashboardSummary(profile, availability, bookings, payout)` returns exactly: profileCompletionPercent, profilePublished, availableWindowCount, averageRating, reviewCount, completedJobCount, completedJobValuePence, committedJobValuePence, payoutState ("unavailable"|"ready"|"action-required"|"not-started"). The prototype's 8 tiles are invented and should be replaced by these. `committedJobValuePence` (accepted but not completed) is missing from the current design.

**Invitations:** `responseDeadline`, urgent at ≤1 hour, then `expired`. `cleanerInvitationDecisionState` returns "different-outcome" when the cleaner acts on a booking the landlord already resolved — a real race the prototype ignores.

**Money language is prescribed per status per role** by `bookingSummaryMoneyBoundary`. Cleaner pending: "This is the offered Cleaner pay. Nothing is earned or transferred unless you accept and complete the booking." Cleaner completed: "This is completed job value, not proof of transfer." NOTE: the prototype's claim that pay is released when the client confirms is wrong — completion means `awaiting-review`, and completed value is explicitly not proof of transfer.

**Checklist contract is real.** `requestTasksFromLines` / `optionalRequestScope` produce `{roomName, description}`, rooms inferred as Kitchen, Bathroom, Bedroom, Living Room, Hallway, else Other; tasks must pass `cleanerTaskQuality().clear`. The landlord's free-text notes become either tasks or a `supplementalNote`. The prototype's rooms+tasks structure matches; the content should come from the request.

**Capability gates:** `cleanerMarketplaceCapabilityState` — if `pricingReady` or `geocodingReady` is false, no requests are sent to the cleaner at all. `landlordMarketplaceCapabilityState` adds mediaReady and automaticDispatchReady. The dashboard should surface this; nothing does today.

### Seam wired into the prototype — 2026-09-08

`homlle-booking.js` is the shared record. Every export mirrors the live
signatures in `public/booking-summary-model.js` / `landlord-dashboard-model.js`
verbatim, so going live is an import change plus dropping `mockBookings()`:

- statuses + `bookingSummaryStatusLabels`, `requestStatusLabels`, `CLEANER_PROGRESS`
- `bookingSummaryBuckets(bookings, role)`, `bookingSummaryPrimaryAction`, `bookingSummaryPriceLabel`
- `bookingSummaryMoneyBoundary(booking, role)` — the prescribed per-status wording
- `cleanerInvitationDeadlineState`, `cleanerInvitationDecisionState`, `formatInvitationTimeRemaining`
- `cleanerDashboardSummary`, `cleanerMarketplaceCapabilityState`
- `tasksByRoom` / `inferredTaskRoom` — the checklist contract
- `mockBookings()` — ONE scenario, three bookings, shaped like `list_my_booking_summaries`; flip `participantRole` to render the Landlord view from the same records.

Consumed by `Cleaner Dashboard Prototype.dc.html` via `import("./homlle-booking.js")`
in `componentDidMount` (DC logic classes cannot use static imports). `STAGES` now
carries the real `status` keys, and the job screen's money line comes from
`bookingSummaryMoneyBoundary` — replacing the false claim that pay is released on
client confirmation.

STILL TO REWIRE onto the module: Activity's 8 invented tiles → the nine
`cleanerDashboardSummary` values (incl. the missing `committedJobValuePence`);
the offer countdown → `cleanerInvitationDeadlineState` with its `expired` state;
`cleanerInvitationDecisionState` "different-outcome"; the capability notice; and
`disputed`, which still has no screen.

### active-job-model.js owns the live job screen — read 2026-09-08

Read `public/active-job-model.js` in full. It already contains most of what the
prototype was inventing. Ported into `homlle-booking.js` verbatim.

- `activeJobStages` — SIX: confirmed, cleaner-en-route, cleaner-arrived, cleaning-in-progress, awaiting-review, completed. The Cleaner screen stops at awaiting-review; the Landlord owns `completed`.
- `activeJobStatusLabels` is a SECOND label map for the same statuses and is NOT interchangeable with `bookingSummaryStatusLabels`. awaiting-review is "Cleaning finished" here and "Awaiting review" there; confirmed is "Booking confirmed" vs "Confirmed". Use the map that owns the surface.
- `activeJobAction(role, tracking, progress, journeyReadiness)` returns `{kind, label, enabled}`. Cleaner labels: "Start journey", "I have arrived", "Start cleaning", "Finish cleaning" — and active-job.html:155 declares that same four-step sequence. THE FINISH GATE IS HERE: enabled only when `total > 0 && resolved === total`, with the label "Resolve N task(s) first" when unmet. Do not invent a gate.
- Two real preconditions the prototype still omits (disclosed on the page as deliberate departures): Start journey is gated behind `journeyReadiness.canStartJourney` ("Check booking authorization"), and en-route offers "Resume location sharing" when `tracking.sharingState !== "live"`.
- `taskCanBeUpdated(role, status)` — ticking is allowed ONLY while `cleaning-in-progress`. Stricter than the prototype's lock-on-complete.
- Unexpected tasks are the real scope-change flow: `taskNeedsCleanerTermsConfirmation` (cleaner confirms frozen terms) then `taskCanBeDecided` (landlord approves). The prototype's "job is bigger than described" incident should become this.
- `DISPUTE_CATEGORIES` — SEVEN: quality, damage, access, safety, conduct, payment, other. The prototype's eight invented categories should map onto these. `bookingDisputePayload` requires ≥20 chars and `confirmed: true`.
- `jobPhotoUploadAllowed(role, status, photoType)` — before/after/issue, only in cleaner-arrived / cleaning-in-progress / awaiting-review, and "before" is NOT allowed at awaiting-review. Photos: jpeg/png/webp/heic, ≤15MB, SHA-256 hashed.
- `bookingReviewView(role, status, review)` — cleaner at awaiting-review: "Waiting for Landlord confirmation" / "Your completed checklist and evidence are ready for the Landlord to review."
- `progressSummary` fields: total, completed, resolved, percentage, unresolved. `journeyProgress` derives ETA-based progress, monotonic, capped at 0.94 until arrival is actually recorded.

LESSON: three verifier rounds went on provenance drift because I built this screen
before reading the file that owns it. For any further screen, read the matching
`*-model.js` FIRST — the product's own labels and rules are usually already there.

### The seam must be READ, not transcribed — 2026-09-08

Three verifier rounds went on provenance drift, then a fourth on a subtler
version of it: `homlle-booking.js` had 35 exports and the prototype consumed 2.
The stage labels and gate label were hand-copied literals that happened to match
what the module returned — grounding by luck, which drifts the moment upstream
changes.

Now derived at render time in `jobVals()`:
- `BOOKING.activeJobStatusLabels[status]` — every stage label and the finish title
- `BOOKING.activeJobAction("cleaner", {status}, {status, totalTasks, resolvedTasks}, {checked, canStartJourney})` — the action label, the finish label AND the enabled flag that gates both buttons
- `BOOKING.taskCanBeUpdated("cleaner", status)` — checkbox permission

`FALLBACK_LABEL` / `FALLBACK_ACTION` exist only because `import()` is async; the
module always wins once loaded. `STAGES` now carries just `status` + an authored note.

Behaviour this corrected: ticking was possible at `cleaner-arrived`, before
cleaning had started. The real rule allows ticks only while
`cleaning-in-progress`, so the checklist is now closed both before and after.

RULE for the rest of this work: if a string or rule exists in a `*-model.js`,
call it — never restate it. A literal that duplicates a module export is a
latent drift bug, even when it currently matches.
