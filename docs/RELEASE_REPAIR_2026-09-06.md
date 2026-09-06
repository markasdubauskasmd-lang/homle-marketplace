# Targeted release repair — 6 September 2026

## Scope and current source

The user approved repairing the uploaded Cleaner registration while preserving Claude's design. On re-fetch, main `129acb0` already restored the original working `cleaner-registration.html` byte-for-byte and moved the supplied design into two standalone previews. This repair preserves that separation. It does not replace the operational registration route or modify Cleaner Dashboard files, shared backend behavior, data, pricing, matching or payment flags.

## Included fixes

1. The previously reviewed Landlord Updates recovery fix (#421): recover a fresh-tab CSRF token, serialize marking-read, retain the original unread cutoff, and distinguish saved read status from a failed refresh.
2. The previously reviewed Landlord message retry fix (#422): reuse the same message reference after an uncertain response, prevent concurrent sends and preserve text typed during a pending send.
3. The uploaded standalone onboarding previews: approved favicon, explicit no-index metadata and root-relative versioned CSS/JavaScript URLs.
4. Remove a broken remote-font import fragment at the start of both preview stylesheets. It caused the browser to discard the following `:root` design-token rule. No replacement fonts, visual redesign or external dependencies were added.
5. Keep the preview screen within the phone viewport and reflow its desktop-positioned introduction cards. Previously a 390px phone rendered a 790px screen starting at x=-200, clipping the logo and instructions. The repair is limited to the existing below-900px rules; desktop composition stays intact.

## Verification

- Cleaner freeze passes with the original expected digest: 89 protected files and 9 shared Cleaner-outcome modules unchanged. No freeze expectations were refreshed.
- Booking dashboard UI test passes, including the existing operational Cleaner registration contracts.
- Real Chromium tests at 390px and 1280px pass for both Landlord fixes.
- Both preview pages are checked in Chromium at 390px and 1280px for loaded design tokens, isolated stylesheets, complete images, screen navigation and invalid-hash recovery.
- The brand test explicitly recognizes the two isolated preview stylesheets. It still requires the approved favicon and additionally verifies the exact root-relative assets, crawler metadata, no inline script handlers, and separation from the live route. Loading the app-wide stylesheet into a design export would overwrite the supplied design.
- The design-system inventory explicitly includes the uploaded previews' self-hosted Archivo font declarations and standalone token ownership, without changing the app's own font/palette checks.

These preview checks are not proof of real registration submission or physical-device testing. The previews remain design references; the working registration remains the application route. Full suite and hosted deployment results are recorded in the PR/release handoff after execution.

## Remaining broader goal

Earlier live verification found no discoverable Cleaner supply, no transactional email provider readiness, and no completed participant payment rehearsal evidence. This release does not claim those external operational requirements are complete. No real customer messages, bookings, charges or emails were created by these checks.
