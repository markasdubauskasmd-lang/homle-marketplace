# Private job-photo boundary

Tideway now has an internal S3-compatible account-marketplace boundary for before, after and issue photos without exposing credentials, reusable keys or permanent URLs. It remains detached from the local NDJSON pilot until PostgreSQL and a real private bucket pass staging.

## Upload lifecycle

1. The assigned Cleaner requests an upload intent for an active booking. The server validates the booking, task, photo category, MIME type, exact byte size, SHA-256 checksum and note.
2. The server generates the upload ID and both storage keys. PostgreSQL records the pending intent before a ten-minute signed `PUT` URL is returned. The browser cannot choose a key and receives no separate reusable key field; depending on the provider, the time-limited URL itself may contain an encoded object path.
3. The browser uploads directly into a private quarantine prefix using signed `Content-Type`, SHA-256 checksum, Tideway checksum metadata and `AES256` server-side-encryption headers. Browser code does not set `Content-Length`; storage records the actual length and Tideway compares it with the frozen declaration before completion.
4. The Cleaner asks Tideway to complete the upload. Tideway reads object metadata from storage and requires an exact size, MIME and checksum match; a browser `complete` claim is never sufficient.
5. Tideway streams at most 15 MB from quarantine, decodes one bounded raster frame through Sharp with a 40-megapixel limit, applies EXIF orientation, flattens transparency, strips metadata by default and re-encodes a new JPEG into the frozen final key. Malformed, oversized, multi-page or failed output is rejected.
6. Only verified processed size, checksum and dimensions enter the completion transaction. That transaction creates the private photo record, adds an actor/timestamp progress event and creates an idempotent participant notification.
7. The original quarantine object is deleted best-effort. A restricted worker expires abandoned database intents and must delete both returned quarantine and possible partially sanitized final keys from object storage. The bucket must also enforce lifecycle expiry as a final cleanup backstop.

Every state-changing endpoint still requires the existing exact-origin, CSRF, session and Cleaner-role middleware. Database functions independently verify the assigned Cleaner and booking stage.

## Read lifecycle

Only the Landlord, assigned Cleaner or authorized Administrator can resolve a job photo. The database returns storage metadata only after the booking-participant check. The service then returns a five-minute signed read URL without returning the object key or checksum. The private bucket must deny public listing and public reads.

## Internal object-storage contract

`src/marketplace/s3-object-storage.mjs` implements the server-only runtime methods:

- `createUploadUrl({ storageKey, mimeType, byteSize, checksumSha256, expiresAt })`
- `headObject({ storageKey })`
- `inspectAndSanitizeImage({ sourceStorageKey, targetStorageKey, sourceMimeType, maximumBytes, stripMetadata })`
- `createReadUrl({ storageKey, expiresAt })`
- optional `deleteObject({ storageKey })`

The attachment constructs this boundary from an exact HTTPS endpoint, bucket, region and restricted credentials. Only the two UUID-shaped Tideway prefixes are accepted. AWS SDK v3 signs ten-minute writes and five-minute no-store reads; Sharp produces the new JPEG and checksum. Startup verifies bucket access. If storage is missing, malformed or unavailable, attachment/media routes fail closed.

The source JPEG re-encode removes metadata and non-image trailing content, but it is not presented as antivirus or harmful-content moderation. Before launch, the selected storage/image-processing threat model must document whether provider-side malware scanning is required, where it runs, its fail-closed status and its quarantine-release signal. Do not claim a malware scan occurred merely because Sharp decoded the file.

## API contracts

- `POST /api/marketplace/bookings/:bookingId/cleaning-progress/photos/intents`
- `POST /api/marketplace/bookings/:bookingId/cleaning-progress/photos/:uploadId/complete`
- `GET /api/marketplace/bookings/:bookingId/cleaning-progress/photos/:photoId/access`

Supported declarations are JPEG, PNG, WebP and HEIC, with a maximum size of 15 MB. Actual decoder support—including HEIC—must pass on the deployed Sharp/libvips build. Sanitized output is JPEG; each side is capped at 20,000 pixels and total decode at 40 megapixels.

## Production enablement gate

Before attachment, apply migration `014_private_job_media.sql` and prove unrelated-user/expired-intent denial, checksum mismatch, malformed/oversized/multi-page rejection, orientation plus EXIF removal, output checksum, quarantine cleanup and five-minute participant reads. Block bucket listing/public reads, require encryption, allow CORS only from `APP_ORIGIN` for `PUT` with the four signed headers, and expire abandoned quarantine objects through a bucket lifecycle backstop. Configure secrets only in the deployment secret manager and grant the identity only the required bucket/prefix operations. Record and test the explicit malware/content-threat decision separately.
