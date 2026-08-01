# Cleaner onboarding database

Homle stores Cleaner onboarding records in the Render PostgreSQL 16 database attached to the `homle-marketplace-preview` Blueprint.

## Coverage

The established marketplace tables remain authoritative for Cleaner profiles, services and rates, work areas, availability, verification results and Stripe payout readiness. Migration `084_cleaner_onboarding_records.sql` adds encrypted account-owned storage for all 18 onboarding sections:

- personal and business details;
- identity, right-to-work and DBS submissions;
- tax and self-employment;
- experience, references and insurance;
- banking handoff state, equipment and transport;
- availability, work areas, languages and skills;
- training, certificates, compliance and declarations.

Section payloads are encrypted by the application with AES-256-GCM before PostgreSQL receives them. The Cleaner user id and section code are authenticated as associated data, so a ciphertext cannot be moved to another Cleaner or section. Direct table access is denied to the application and worker roles; owner-bound security-definer functions provide the only application path and every save writes an audit entry.

## HTTP interface

- `GET /api/marketplace/cleaner/onboarding` lists the signed-in Cleaner's saved sections.
- `GET /api/marketplace/cleaner/onboarding/:section` reads one section.
- `PUT /api/marketplace/cleaner/onboarding/:section` saves a draft or submitted section and requires the Cleaner role, exact origin and CSRF token.

Payloads are bounded to 64 KiB per section, nested values are bounded and cleaned, and embedded data URLs are rejected.

## Documents and banking

`cleaner_onboarding_documents` stores private document metadata, verification status, checksum, expiry and an encrypted object-storage key. Large identity, DBS and insurance files must live in the existing encrypted S3-compatible object-storage boundary, not as database blobs.

Homle never accepts raw bank account or card fields through the onboarding-record API. Those details remain in Stripe Connect; PostgreSQL stores only the existing provider account reference and bounded readiness flags.

## Deployment

The Render staging entrypoint verifies the locked migration chain and applies migration 084 on the next service deployment. Deployment verification proves both onboarding tables have row-level security, the application cannot query them directly, the encrypted payload column is `bytea`, and the owner-only save function retains its audit boundary.
