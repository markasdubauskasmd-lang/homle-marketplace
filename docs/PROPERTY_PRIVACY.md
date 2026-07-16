# Landlord property privacy boundary

This Phase 2 checkpoint adds the service and repository boundary for a landlord profile and multiple saved properties. It is intentionally not exposed as a public page yet: the account-backed PostgreSQL runtime and authenticated property routes must be composed and tested against a real staging database first.

## Implemented

- Only an authenticated `landlord` actor can create, update or list properties through the service.
- The server selects the owner from the authenticated session; a request body cannot choose `landlord_user_id`.
- Update queries require both property ID and authenticated landlord ID. PostgreSQL row-level security repeats the ownership check.
- Names, UK postcodes, property types, room counts, approximate size, coordinates, notes and saved tasks are bounded and canonicalised before persistence.
- Entry/access instructions use AES-256-GCM authenticated encryption with a random nonce. The authentication context includes the property ID, so ciphertext cannot be moved silently between properties.
- `DATA_ENCRYPTION_KEY` must contain at least 32 characters and must differ from both session and authentication-token secrets. Store it only in the deployment secret manager; rotating it requires an explicit re-encryption migration.
- Service responses use a field whitelist. Ciphertext, owner IDs and precise coordinates are never returned.
- Landlords and administrators retain access to the property they are authorised to manage. An assigned cleaner receives exact address, access, parking and special notes only from confirmation through `awaiting-review`.
- Pending, declined, cancelled, completed and disputed bookings do not expose those protected fields to the cleaner. Property and photo RLS policies use the same active-booking window.
- The booking-property repository requires the actor to be the landlord, assigned cleaner or administrator even before service-level projection.

## Still required before enabling property pages

1. Run every migration against an empty PostgreSQL 16 staging database using separate migration-owner and restricted runtime roles.
2. Add database integration tests proving landlord ownership, unrelated-user denial and active-booking cleaner expiry under actual RLS.
3. Attach the prepared `/api/marketplace/properties` controllers after real session/RLS staging tests.
4. Add mobile-first property forms using existing Tideway components, including explicit photo consent, validation, retry and delete confirmation states.
5. Provision and test the internal private object-storage boundary: signed checksum/encryption headers, MIME/size verification, bounded decoding, EXIF-stripping JPEG output, explicit malware/threat controls and approved retention/deletion. Store object keys, never public URLs.
6. Decide and document whether exact address, parking notes and special notes require column-level encryption in addition to RLS and service projection before production data is imported.

No invented properties, addresses, access instructions or photographs have been added to the live data directory.
