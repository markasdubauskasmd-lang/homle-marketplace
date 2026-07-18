# Homle brand and interface system

## Brand assets

- `public/logo.svg` is the single browser and product logo.
- Generated application icons remain in `public/app-icon-*.png` and `public/apple-touch-icon.png`.
- Do not introduce a second logo or replace the Homle name on a role-specific page.

## Visual language

- **Black** (`#0b090a`) identifies secure navigation, account context and professional workspaces.
- **Homle red** (`#e31937`) identifies the next deliberate action, active state and progress.
- **Warm white** (`#fffefd`) is the primary reading surface.
- **Warm neutral** (`#f2eee9`) separates panels without making the product feel like a management console.
- Yellow is reserved for keyboard focus so focus remains visible against black, white and red.

## Interaction rules

- Keep one obvious red action per decision area.
- Use black or white outlined controls for secondary actions.
- Preserve large mobile targets (at least 44px; primary controls are 50px).
- Never use colour alone for booking, payment, safety or error meaning; keep the existing text and status labels.
- Landlord and Cleaner workspaces remain separate in structure and authorization even though they share the Homle visual system.
- Presentation changes must not rename `data-*` hooks, form fields, routes or server-owned status values.

## Responsive behaviour

- The public hero becomes a single-column action path on phones.
- Booking forms stack the black introduction above the white form surface.
- Workspace navigation remains reachable horizontally on small screens.
- Dashboard actions, scan controls and payment controls expand to one-hand-friendly widths where the existing component requires it.

## Verification

After a visual change:

1. Run `pnpm run check` and `pnpm test`.
2. Check the homepage, `/request`, `/login`, `/landlord/dashboard`, `/cleaner/dashboard` and `/active-job` at desktop and 390px width.
3. Confirm the account avatar, role label, navigation, primary action, fields and error/success states remain visible.
4. Increment the `styles.css` query version on every HTML entry point before deployment.
