# The one payment check a human has to do

Everything about this payment is covered by the suite except typing a card
number into Stripe's own iframe. No honest harness can do that: the fields
belong to a cross-origin frame owned by the payment provider, which is the
entire point of them. This is the short list of what a person still has to
confirm after a deploy, and — just as usefully — what they do **not** need to,
because it is already held.

## Already covered, do not re-test by hand

| Behaviour | Where |
|---|---|
| Live Stripe keys rejected outright | `tests/stripe-payment-provider.mjs` |
| Exact commands sent to Stripe, signed event projection | `tests/stripe-payment-provider.mjs` |
| Amount frozen server-side; the browser cannot move it | `tests/payment-service.mjs`, `tests/payment-repository.mjs` |
| Private idempotency; one payment per booking | `tests/payment-service.mjs`, `tests/landlord-request-flow.mjs` |
| Signed webhook reconciliation | `tests/payment-service.mjs` |
| Checkout opens on the frozen total | `tests/landlord-request-flow.mjs` |
| Reload mid-payment resumes without a second authorization | `tests/landlord-request-flow.mjs` |
| Failed authorization offers an honest retry | `tests/landlord-request-flow.mjs` |
| A webhook arriving after the tab closed still completes | `tests/landlord-request-flow.mjs` |
| A declined card keeps the form open with Stripe's reason | `tests/landlord-checkout-confirm.mjs` |
| **A browser-reported success never reads as paid** while the server says processing | `tests/landlord-checkout-confirm.mjs` |
| An errored confirm claims nothing | `tests/landlord-checkout-confirm.mjs` |

The confirm suite stubs `window.Stripe` and runs every branch of *our* handling
against the shapes Stripe documents. What it cannot prove is that Stripe's real
element mounts and accepts a card in the deployed environment — which is
exactly, and only, what the list below is for.

## The manual check

Stripe test mode. Nothing below moves real money; the adapter refuses live keys.

1. Sign in as a Landlord with a **confirmed** booking that has a price.
   Payments → the booking should read **Awaiting your authorisation** and offer
   **Authorize £X securely**.
2. Follow it to `/landlord/checkout?bookingId=…`. Confirm the amount matches the
   booking total exactly, and that the strip above it names the right place,
   time and cleaner.
3. Press **Enter secure payment details**. Stripe's element should mount inside
   the card — this is the step under test.
4. Pay with the Stripe test card **4242 4242 4242 4242**, any future expiry, any
   CVC, any postcode.
5. Expect: *Authorization submitted* → *being verified* → **Payment authorized**
   with **Open confirmed booking**. The middle state may flash past; that is the
   page waiting on the signed webhook rather than trusting the browser.
6. Reload the page. It must still read authorized — the state came from the
   server, not the tab.

### Also worth doing once

- **A decline:** card **4000 0000 0000 0002**. The form should stay open with
  Stripe's own reason and no claim of completion.
- **Authentication:** card **4000 0025 0000 3155** triggers 3-D Secure. Complete
  the challenge and expect the same three states.
- **Abandonment:** open checkout, mount the element, close the tab without
  paying. The booking must remain confirmed-and-unpaid, and reopening checkout
  must resume rather than start a second payment.

## If step 3 fails

The element failing to mount is a configuration problem, not a code one, and
`tests/landlord-request-flow.mjs` already proves the page reports it honestly
rather than hanging. Check, in this order:

1. `/api/marketplace/payments/config` returns `testMode: true` and a
   `pk_test_…` publishable key.
2. The deployed environment allows `https://js.stripe.com` — a Content-Security
   -Policy that omits it blocks the element with no message from Stripe.
3. The booking's payment row exists server-side: `GET
   /api/marketplace/bookings/<id>/payment` should report a status other than
   `not-started` once **Enter secure payment details** has been pressed.
