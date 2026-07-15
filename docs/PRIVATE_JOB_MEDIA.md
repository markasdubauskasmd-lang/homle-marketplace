# Private job-photo boundary

Tideway now has an account-marketplace contract for before, after and issue photos without exposing object-storage credentials or permanent object URLs to a browser. This source checkpoint remains detached from the local NDJSON pilot until PostgreSQL migration evidence and a production object-storage adapter exist.

## Upload lifecycle

1. The assigned Cleaner requests an upload intent for an active booking. The server validates the booking, task, photo category, MIME type, exact byte size, SHA-256 checksum and note.
2. The server generates the upload ID and both storage keys. PostgreSQL records the pending intent before a ten-minute signed `PUT` URL is returned. The browser cannot choose a key and receives no separate reusable key field; depending on the provider, the time-limited URL itself may contain an encoded object path.
3. The browser uploads directly into a private quarantine prefix using the required content type, size and checksum headers.
4. The Cleaner asks Tideway to complete the upload. Tideway reads object metadata from storage and requires an exact size, MIME and checksum match; a browser `complete` claim is never sufficient.
5. The storage adapter must decode the image, reject unsafe or malformed content, perform the provider-approved malware/content check, strip metadata including EXIF, and re-encode the result as JPEG into the frozen final key.
6. Only verified processed size, checksum and dimensions enter the completion transaction. That transaction creates the private photo record, adds an actor/timestamp progress event and creates an idempotent participant notification.
7. The original quarantine object is deleted best-effort. A restricted worker expires abandoned database intents and must delete both returned quarantine and possible partially sanitized final keys from object storage. The bucket must also enforce lifecycle expiry as a final cleanup backstop.

Every state-changing endpoint still requires the existing exact-origin, CSRF, session and Cleaner-role middleware. Database functions independently verify the assigned Cleaner and booking stage.

## Read lifecycle

Only the Landlord, assigned Cleaner or authorized Administrator can resolve a job photo. The database returns storage metadata only after the booking-participant check. The service then returns a five-minute signed read URL without returning the object key or checksum. The private bucket must deny public listing and public reads.

## Object-storage adapter contract

`createMarketplaceRuntime` accepts a server-only `objectStorage` implementation with:

- `createUploadUrl({ storageKey, mimeType, byteSize, checksumSha256, expiresAt })`
- `headObject({ storageKey })`
- `inspectAndSanitizeImage({ sourceStorageKey, targetStorageKey, sourceMimeType, maximumBytes, stripMetadata })`
- `createReadUrl({ storageKey, expiresAt })`
- optional `deleteObject({ storageKey })`

The adapter must normalize object checksums to lowercase hexadecimal SHA-256. Signed URLs must be HTTPS outside localhost. If the adapter is missing or incomplete, every media route fails closed with HTTP 503.

## API contracts

- `POST /api/marketplace/bookings/:bookingId/cleaning-progress/photos/intents`
- `POST /api/marketplace/bookings/:bookingId/cleaning-progress/photos/:uploadId/complete`
- `GET /api/marketplace/bookings/:bookingId/cleaning-progress/photos/:photoId/access`

Supported upload MIME types are JPEG, PNG, WebP and HEIC, with a maximum declared size of 15 MB. Sanitized output is always JPEG and dimensions are capped at 20,000 pixels per side.

## Production enablement gate

Before attachment, apply migration `014_private_job_media.sql` in staging and prove unrelated-user denial, expired-intent denial, checksum mismatch rejection, malformed-image rejection, EXIF removal, malware-test rejection, quarantine cleanup and private-bucket access denial. Configure credentials only in the deployment secret manager and grant the storage identity access only to Tideway's private bucket and prefixes.
