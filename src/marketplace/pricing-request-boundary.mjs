// The line between what a customer's browser says and what Homle prices.
//
// SERVER ONLY.
//
// The browser runs the same pricing engine the server does, which is what lets
// a total move the instant a task is tapped instead of after a round trip. The
// cost of that is that the REQUEST reaching the server is shaped by code the
// customer controls, and three of its fields are worth money:
//
//   * `now` decides urgency. A browser claiming it is next Tuesday turns a
//     same-day booking into an ordinary one and takes 20% off.
//   * `promotion` decides the discount. A browser that could attach its own
//     would only ever attach the largest one it could invent.
//   * `postcode` decides the location band. Claiming a cheap area for a London
//     property is a 15% discount for typing.
//   * `startAt` decides the unsocial-hours charge, and belongs to the booking
//     rather than to the price preview.
//
// None of them are refused, because refusing would mean the customer's screen
// could not show a running total at all. They are REPLACED, here, with the
// values the server already knows to be true. The engine then computes exactly
// what the browser computed, or something different — and if it is different,
// the server's number is the one that is charged.
//
// Everything else on the request is scope: which rooms, which tasks, which
// service. The engine already bounds and validates all of it, and getting it
// wrong costs the customer a wrong price rather than a cheap one.

import { normalizedPricingConfig, resolvePromotion } from "../../public/pricing-config.js";

/**
 * A pricing request that can be trusted.
 *
 * @param untrusted  what arrived from the browser
 * @param trusted    { config, now, startAt, postcode, previousBookingCount }
 *
 * `startAt` and `postcode` are only overridden when the caller supplies them.
 * At quote time there is no booking and no property yet, so the customer's
 * stated area and chosen slot are all there is — and they are the same values
 * that will be checked against the real property when the quote is frozen onto
 * a request. At freeze time the caller passes the property's own postcode and
 * the request's own start time, and a browser's claim is discarded.
 */
export function trustedPricingRequest(untrusted = {}, trusted = {}) {
  const source = untrusted && typeof untrusted === "object" ? untrusted : {};
  const config = trusted.config ? normalizedPricingConfig(trusted.config) : null;
  const now = trusted.now instanceof Date ? trusted.now : new Date();

  // Never the browser's. Deleted rather than overwritten so a field renamed in
  // future does not silently start being honoured again.
  const { now: discardedNow, promotion: discardedPromotion, ...scope } = source;

  const promotionCode = String(source.promotionCode || discardedPromotion?.code || "").trim().toUpperCase();
  const promotion = config && promotionCode
    ? resolvePromotion(config, promotionCode, {
      now,
      previousBookingCount: Number(trusted.previousBookingCount) || 0
    })
    : null;

  return {
    ...scope,
    now: now.toISOString(),
    ...(trusted.startAt ? { startAt: String(trusted.startAt) } : {}),
    ...(trusted.postcode ? { postcode: String(trusted.postcode) } : {}),
    ...(promotionCode ? { promotionCode } : {}),
    // Absent rather than null when nothing resolved, so the engine's own
    // shape check is never handed an object to reason about.
    ...(promotion ? { promotion } : {})
  };
}
