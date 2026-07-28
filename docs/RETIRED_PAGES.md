# Retired public pages

Effective 28 July 2026, Homle uses its authenticated Landlord and Cleaner dashboards as the only role workspaces. The following legacy/demo pages and their browser controllers were permanently removed:

- `/request` and `/join`
- `/cleaners`
- `/marketplace-preview`
- `/brief` and `/brief-complete`
- `/quote`
- `/booking-payment`
- `/booking-confirmation` and `/assignment`
- `/request-status`
- `/cleaner/availability`
- `/cleaner-status`

The physical HTML and JavaScript assets were deleted, their static server route mappings were removed, and visible navigation was consolidated into `/landlord/dashboard`, `/landlord/book`, `/cleaner/dashboard`, and authenticated account onboarding.

The server-side marketplace services and protected APIs remain in place because the current dashboards still use them for saved properties, room scans, Cleaner matching data, availability state, booking state, payments and notifications. This retirement removes duplicate browser pages; it does not delete business records or database capabilities.

`tests/retired-pages.mjs` is the permanent regression gate. It fails if a removed asset, route mapping, or visible link is restored.
