# Homlle design snapshot

Saved from `App structure decisions homlle.zip` on 8 September 2026. The original design files, reference images, handoff notes and previous export attempts are preserved here. `index.html` adds a navigation shell for reviewing the designs together.

These are interactive prototypes with sample data, not connected marketplace workflows. Known gaps are recorded in `HANDOFF.md`; archive notes describe past decisions, not deployment instructions.

## Preview

Serve this directory with a static web server and open `index.html`. The main screens use the supplied Design Component runtime. Some screens load React, Babel, fonts and map resources from external hosts, so internet access is required.

## Render preview

- Repository: `markasdubauskasmd-lang/homle-marketplace`
- Branch: `main`
- Existing service: `homle-marketplace-preview`
- Entry point: `/design-preview/index.html`
- Published files: `public/design-preview`

The original runtime uses dynamic evaluation and remote scripts that the application blocks. `tools/export-homlle-design.mjs` exports static logic factories, local dependencies and external stylesheets for the existing service. The preview keeps scripts and styles self-only, allows same-origin frames for the screen navigator and phone view, and allows OpenStreetMap tile images. Production routes retain their policies. These pages do not replace production pages or connect prototype actions to live accounts.

To rebuild, supply the exporter with a directory containing the pinned packages documented at the top of the script. Babel is a build-only dependency. The generated preview is committed, so Render needs no additional build command or dependency changes.
