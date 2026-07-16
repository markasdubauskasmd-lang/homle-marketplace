# Private account room scans

## What is implemented

The authenticated Landlord journey now treats the room scan as the submission boundary:

1. The Landlord creates a future private cleaning-request draft from an editable room-labelled checklist. Speech recognition can prepare the concise bullets, but the browser never submits them without review.
2. A draft card offers separate rear-camera and existing-photo controls. Each image must name a room already present in the checklist and include a short scope note.
3. The browser accepts one JPEG, PNG, WebP or HEIC image up to 15 MB, calculates its SHA-256 digest and requests a ten-minute upload intent.
4. The original goes directly to a server-selected quarantine key through an exact signed `PUT`. Tideway cookies, referrer data and redirects are excluded.
5. The server checks the stored type, byte count and checksum, decodes one bounded still image, applies orientation, flattens alpha, strips metadata and re-encodes a private JPEG. Only verified output metadata enters PostgreSQL; quarantine is then removed.
6. At least one completed photo and one checklist task are required. Pending uploads, unknown room names, past/near-start requests and more than ten photos prevent submission.
7. The Landlord must explicitly confirm the full checklist/photo scope and separately choose whether the one invited Cleaner may preview photos before accepting.
8. Submission freezes a combined checklist-and-scan fingerprint, records actor/timestamp consent in request history and audit history, and changes the request from `draft` to `searching-for-cleaner`.
9. Automatic dispatch remains a second optional consent with a total one-to-five invitation limit. Submitting a scan does not itself create a booking, take payment or contact multiple Cleaners.

## Participant privacy

- The owning Landlord and an Administrator can list safe photo metadata.
- An invited Cleaner can list/view the scan before acceptance only when the Landlord selected preview consent.
- The assigned Cleaner can access it after confirmation and during/after the active job.
- The scan response contains room names, notes, safe dimensions and photo IDs; it does not contain object keys, checksums, Landlord identity, exact address, access instructions or contact details.
- Photo contents use five-minute signed, private, no-store reads. The web/worker roles have no direct table access to storage keys or upload verification records.
- Expired pending uploads are leased in bounded `SKIP LOCKED` batches for worker cleanup.

## Web camera behavior

The rear-camera input uses `accept="image/*" capture="environment"`, while the existing-photo input deliberately omits `capture`. Mobile browsers still control the final camera chooser, so Tideway cannot guarantee that every browser opens directly into a live camera. The final HTTPS device trial must cover the supported iPhone/Android browsers.

This account path accepts still images only. Secure video ingestion remains closed because the current sanitizer is designed for bounded single-frame images; Tideway must not store unprocessed customer video under an image-safety claim.

## Activation gate

The feature is complete in detached source but remains unavailable on the current local pilot while `MARKETPLACE_ENABLED=false`. Migration `030_private_request_room_scans.sql`, the corrective invitation migration 031, runtime/worker grants and the disposable harness passed from a fresh PostgreSQL 16.14 database on 16 July 2026 with fixture cleanup verified. Before activation, repeat that proof in managed staging; the approved private bucket must pass CORS, encryption, public-access, lifecycle and content-threat tests; and the final HTTPS site must pass a two-account mobile camera/upload/preview/submission trial.
