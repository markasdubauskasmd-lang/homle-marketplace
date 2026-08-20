# Continuous improvement — 20 August 2026

## Transactional-email activation guide

The live Render service was inspected without reading or exposing any secret
values. Its environment currently contains neither a configured transactional
email provider nor the required Resend sender and webhook settings, while the
public DNS for `homlle.com` does not yet publish a DMARC record or the
provider-supplied sender-verification records.

The private Administrator launch panel now expands an exact, ordered activation
guide whenever its existing `transactionalEmail` readiness check is false. It
names only environment-variable keys, the public signed-webhook URL and the
safe activation order. It never reads, renders, copies or stores a provider key
or webhook secret. Once the running environment reports email ready, the guide
closes and hides automatically.

This is an Administrator-only launch-control improvement. Authentication,
email delivery, booking behavior and every Cleaner Dashboard file remain
unchanged. Provider account creation, sender-domain verification and secret
entry are still external operator actions; the UI does not pretend they have
already happened.
