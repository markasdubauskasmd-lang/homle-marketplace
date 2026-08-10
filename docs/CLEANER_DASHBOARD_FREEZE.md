# Cleaner Dashboard no-change boundary

The active Homle product objective makes the entire Cleaner Dashboard a strict
no-change area. The rest of the marketplace may continue to improve, but work on
Landlord, customer, public, Administrator or deployment surfaces must not alter
the Cleaner workspace accidentally.

`tests/cleaner-dashboard-freeze.mjs` enforces that boundary in every normal test
run. It pins, byte for byte:

- every `public/cleaner-*` page and script;
- `public/homle-cleaner.css`;
- the active-job files used by the Cleaner job lifecycle;
- the shared browser modules, base stylesheet, manifest, and approved logo loaded
  by the Cleaner workspace; and
- every dedicated `src/marketplace/cleaner-*` service and repository module.

The test discovers dedicated Cleaner files dynamically. Adding, removing or
renaming one therefore fails as well as editing one. Existing behavioural,
route, access-control, database, payment, notification and mobile tests remain
the second layer for shared server contracts that cannot safely be frozen as
whole files.

## Change protocol

Do not update the expected digest to make CI green. Under the current objective,
the correct response to a failure is to move the proposed change out of the
Cleaner boundary or revert it. The digest may be deliberately refreshed only if
the user explicitly replaces the no-change objective and the complete Cleaner
journey is reviewed again.

This guard does not change, load, or execute the Cleaner Dashboard at runtime. It
is repository and CI protection only.
