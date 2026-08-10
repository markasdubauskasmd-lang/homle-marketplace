// Turns a set of rooms and the things in them into one exact price, and says
// what that price does to the business.
//
// TWO PROMISES THIS MODULE MAKES
//
//   1. **The lines add up.** Every quote carries a breakdown, and the breakdown
//      sums to the total exactly. Not approximately — exactly, in integer pence.
//      A customer who adds up the numbers on their screen must reach the number
//      they are charged, and a test asserts it on every scenario.
//
//   2. **No quote is sold at a loss.** Every quote computes its own economics:
//      what the customer pays, what the cleaner earns, what the processor takes
//      and what is left. If what is left falls under the configured floor, the
//      quote is returned unpriceable with a reason, rather than booked.
//
// WHAT THIS IS NOT
//
// It is not an estimate. scan-pricing.mjs produces an estimate with a range and
// an `isEstimate` flag that nothing can clear, because it prices from a vision
// model's reading of a room. This module prices from a CONFIRMED list of rooms
// and tasks — what the customer selected and can see — so it returns one
// number. The distinction matters: the range exists to express uncertainty
// about what is in the room, and once the customer has confirmed the list there
// is none left to express.
//
// ROUNDING
//
// All arithmetic is integer pence. Percentages are basis points and every
// division is floored or rounded exactly once, at the point of use, into a line
// item. Nothing is re-derived from a rounded number, which is how breakdowns
// drift away from their totals.

import { normalizedPricingConfig, roomDefinition } from "./pricing-config.mjs";

const basisPointDivisor = 10000;

function line(code, label, pence, meta = {}) {
  return Object.freeze({ code, label, pence, ...meta });
}

function money(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function formatPounds(pence) {
  return `£${(pence / 100).toFixed(2)}`;
}

function unpriceable(code, reason, config) {
  return Object.freeze({
    priceable: false,
    code,
    reason,
    currency: "GBP",
    configId: config?.configId ?? "default",
    configVersion: config?.version ?? 0,
    totalPence: 0,
    estimatedMinutes: 0,
    rooms: Object.freeze([]),
    lines: Object.freeze([]),
    economics: null
  });
}

/**
 * Prices one room.
 *
 * The brief's rule, exactly: the first N ordinary tasks are what the base price
 * already pays for, and each one after that is charged. Premium items never
 * consume an included slot and are never charged at the per-item rate — an oven
 * is not a mirror, and pricing it as one would pay a cleaner about a pound to
 * spend forty minutes on it.
 */
function priceRoom(room, config, index) {
  const definition = roomDefinition(config, room?.roomType);
  const items = Array.isArray(room?.items) ? room.items : [];

  const premiums = [];
  const ordinary = [];
  for (const item of items) {
    const code = String(item?.code || "").trim();
    const premium = config.premiumItems[code];
    if (premium) premiums.push({ code, ...premium });
    else ordinary.push({ code, label: String(item?.label || code || "Task").slice(0, 80) });
  }

  const included = Math.min(ordinary.length, definition.includedItems);
  const additional = Math.max(0, ordinary.length - definition.includedItems);
  const additionalPence = additional * config.additionalItemPence;

  const lines = [
    line("room-base", `${definition.label} — base clean`, definition.basePence, { kind: "base" })
  ];
  // Named individually so the customer can see which task cost what — the
  // difference between a price that changed and a price that just went up.
  ordinary.forEach((item, position) => {
    const includedItem = position < definition.includedItems;
    lines.push(line(`item:${item.code || position}`, item.label, includedItem ? 0 : config.additionalItemPence, {
      kind: includedItem ? "included" : "additional",
      included: includedItem
    }));
  });
  for (const premium of premiums) {
    lines.push(line(`premium:${premium.code}`, premium.label, premium.pence, { kind: "premium" }));
  }

  const premiumPence = premiums.reduce((total, premium) => total + premium.pence, 0);
  const minutes = definition.baseMinutes
    + additional * config.additionalItemMinutes
    + premiums.reduce((total, premium) => total + premium.minutes, 0);

  return Object.freeze({
    index,
    roomType: String(room?.roomType || "other"),
    label: String(room?.label || definition.label).slice(0, 80),
    basePence: definition.basePence,
    includedCount: included,
    includedAllowance: definition.includedItems,
    additionalCount: additional,
    additionalPence,
    premiumPence,
    // Room subtotal excludes premiums: discounts and the service multiplier
    // apply to cleaning the room, not to the standalone jobs inside it.
    subtotalPence: definition.basePence + additionalPence,
    totalPence: definition.basePence + additionalPence + premiumPence,
    minutes,
    lines: Object.freeze(lines)
  });
}

/**
 * The quote.
 *
 * @param request  { serviceType, frequency, rooms:[{roomType,label,items:[{code,label}]}], addOns:[{code,quantity}] }
 * @param config   a pricing configuration (normalised here if it is not already)
 */
export function quoteRooms(request = {}, config = {}) {
  const rules = normalizedPricingConfig(config);

  const rooms = Array.isArray(request?.rooms) ? request.rooms.slice(0, 40) : [];
  if (!rooms.length) return unpriceable("no-rooms", "Add at least one room before a price can be worked out.", rules);

  const serviceCode = String(request?.serviceType || "standard");
  const service = rules.serviceTypes[serviceCode] ?? rules.serviceTypes.standard;
  const frequency = String(request?.frequency || "one-time");

  const pricedRooms = rooms.map((room, index) => priceRoom(room, rules, index));

  const roomSubtotalPence = pricedRooms.reduce((total, room) => total + room.subtotalPence, 0);
  const premiumPence = pricedRooms.reduce((total, room) => total + room.premiumPence, 0);

  const lines = [];
  lines.push(line("rooms", `${pricedRooms.length} ${pricedRooms.length === 1 ? "room" : "rooms"}`, roomSubtotalPence, { kind: "subtotal" }));

  // 1. Service type, against the room subtotal only. A deep clean means more
  //    work per room; it does not mean the oven costs more.
  const serviceAdjustmentPence = Math.round(roomSubtotalPence * service.multiplierBasisPoints / basisPointDivisor) - roomSubtotalPence;
  if (serviceAdjustmentPence !== 0) {
    lines.push(line("service", `${service.label} — ${serviceAdjustmentPence > 0 ? "adds" : "reduces by"} ${Math.abs(Math.round((service.multiplierBasisPoints - basisPointDivisor) / 100))}%`, serviceAdjustmentPence, { kind: "service" }));
  }
  const afterService = roomSubtotalPence + serviceAdjustmentPence;

  // 2. Multi-room. The cleaner is already there and setup is paid once.
  const bands = rules.discounts.multiRoomBasisPoints;
  const applicable = Object.keys(bands)
    .map(Number)
    .filter((threshold) => pricedRooms.length >= threshold)
    .sort((a, b) => b - a)[0];
  const multiRoomBasisPoints = applicable ? bands[applicable] : 0;
  const multiRoomDiscountPence = -Math.round(afterService * multiRoomBasisPoints / basisPointDivisor);
  if (multiRoomDiscountPence !== 0) {
    lines.push(line("multi-room", `${pricedRooms.length}-room saving — ${multiRoomBasisPoints / 100}%`, multiRoomDiscountPence, { kind: "discount" }));
  }

  // 3. Recurring.
  const recurringBasisPoints = rules.discounts.recurringBasisPoints[frequency] ?? 0;
  const recurringDiscountPence = -Math.round(afterService * recurringBasisPoints / basisPointDivisor);
  if (recurringDiscountPence !== 0) {
    lines.push(line("recurring", `${frequency.replace(/-/g, " ")} saving — ${recurringBasisPoints / 100}%`, recurringDiscountPence, { kind: "discount" }));
  }

  // 4. Premium items, whole and undiscounted.
  if (premiumPence) lines.push(line("premium-items", "Specialist tasks", premiumPence, { kind: "premium" }));

  // 5. Whole-visit add-ons.
  let addOnPence = 0;
  let addOnMinutes = 0;
  for (const chosen of Array.isArray(request?.addOns) ? request.addOns.slice(0, 20) : []) {
    const definition = rules.addOns[String(chosen?.code || "").trim()];
    if (!definition) continue;
    const quantity = Math.min(Math.max(Number(chosen?.quantity) || 1, 1), 20);
    const pence = definition.pence * quantity;
    addOnPence += pence;
    addOnMinutes += definition.minutes * quantity;
    lines.push(line(`add-on:${chosen.code}`, quantity > 1 ? `${definition.label} × ${quantity}` : definition.label, pence, { kind: "add-on" }));
  }

  const beforeMinimum = afterService + multiRoomDiscountPence + recurringDiscountPence + premiumPence + addOnPence;

  // 6. The floor. Below this a visit does not cover getting there. The service
  //    type can raise it — an end-of-tenancy clean has a guarantee behind it.
  const floor = Math.max(rules.minimumBookingPence, service.minimumPence);
  const minimumAdjustmentPence = Math.max(0, floor - beforeMinimum);
  if (minimumAdjustmentPence > 0) {
    lines.push(line("minimum", `Minimum ${service.label.toLowerCase()} charge of ${formatPounds(floor)}`, minimumAdjustmentPence, { kind: "minimum" }));
  }

  const totalPence = beforeMinimum + minimumAdjustmentPence;

  const estimatedMinutes = pricedRooms.reduce((total, room) => total + room.minutes, 0) + addOnMinutes;
  const economics = quoteEconomics(totalPence, estimatedMinutes, rules);

  // The margin guard. A configuration that cannot pay everyone is not a cheap
  // booking, it is a loss, and it must not reach a customer.
  if (!economics.healthy) {
    return unpriceable("margin-floor", `This selection cannot be priced profitably: ${economics.reason}`, rules);
  }

  const total = lines.reduce((sum, entry) => sum + entry.pence, 0);
  // Not a defensive nicety. If this ever fires, a customer is being shown a
  // breakdown that does not match their charge, and silence would be worse.
  if (total !== totalPence) {
    return unpriceable("breakdown-mismatch", "The price breakdown did not reconcile against the total.", rules);
  }

  return Object.freeze({
    priceable: true,
    code: "",
    reason: "",
    currency: "GBP",
    configId: rules.configId,
    configVersion: rules.version,
    serviceType: serviceCode,
    serviceLabel: service.label,
    frequency,
    rooms: Object.freeze(pricedRooms),
    lines: Object.freeze(lines),
    roomSubtotalPence,
    premiumPence,
    addOnPence,
    serviceAdjustmentPence,
    discountPence: multiRoomDiscountPence + recurringDiscountPence,
    minimumAdjustmentPence,
    totalPence,
    estimatedMinutes,
    economics
  });
}

/**
 * What one booking does to the business.
 *
 * Computed for every quote rather than in a reporting job afterwards, because a
 * margin that is only visible in a monthly report is a margin nobody defends at
 * the moment it is given away.
 */
export function quoteEconomics(totalPence, estimatedMinutes, config = {}) {
  const rules = config.economics ? config : normalizedPricingConfig(config);
  const economics = rules.economics;

  const customerPaysPence = money(totalPence);
  const cleanerPayoutPence = Math.round(customerPaysPence * economics.cleanerShareBasisPoints / basisPointDivisor);
  const paymentFeePence = economics.paymentFeeFixedPence + Math.ceil(customerPaysPence * economics.paymentFeeBasisPoints / basisPointDivisor);
  const platformRevenuePence = customerPaysPence - cleanerPayoutPence;
  const grossMarginPence = platformRevenuePence - paymentFeePence;
  const grossMarginBasisPoints = customerPaysPence > 0
    ? Math.round((grossMarginPence / customerPaysPence) * basisPointDivisor)
    : 0;

  const hours = Math.max(estimatedMinutes, 1) / 60;
  const effectiveCleanerHourlyPence = Math.round(cleanerPayoutPence / hours);

  let reason = "";
  if (grossMarginPence < economics.minimumContributionPence) {
    reason = `it contributes ${formatPounds(grossMarginPence)} against a ${formatPounds(economics.minimumContributionPence)} minimum`;
  } else if (grossMarginBasisPoints < economics.targetGrossMarginBasisPoints) {
    reason = `its margin is ${(grossMarginBasisPoints / 100).toFixed(1)}% against a ${(economics.targetGrossMarginBasisPoints / 100).toFixed(1)}% target`;
  } else if (effectiveCleanerHourlyPence < economics.cleanerHourlyFloorPence) {
    // Not a margin failure — the opposite. The booking is profitable but pays
    // the cleaner too little per hour to be accepted, which is a supply failure
    // and shows up as unfilled jobs rather than lost money.
    reason = `it would pay the cleaner ${formatPounds(effectiveCleanerHourlyPence)}/hour against a ${formatPounds(economics.cleanerHourlyFloorPence)}/hour floor`;
  }

  return Object.freeze({
    customerPaysPence,
    cleanerPayoutPence,
    paymentFeePence,
    platformRevenuePence,
    grossMarginPence,
    grossMarginBasisPoints,
    estimatedMinutes,
    effectiveCleanerHourlyPence,
    cleanerShareBasisPoints: economics.cleanerShareBasisPoints,
    healthy: reason === "",
    reason
  });
}

/**
 * Maps a completed room scan onto the quote input.
 *
 * The scanner already produces rooms and the objects found in them. This turns
 * that into the task list the customer confirms — it does not price anything
 * itself, so the number on the scanner and the number at checkout come from the
 * same function.
 */
export function quoteInputFromScan(scan = {}, options = {}) {
  const rooms = (Array.isArray(scan?.rooms) ? scan.rooms : []).map((room) => ({
    roomType: room?.roomType || room?.roomName || "other",
    label: room?.roomName || room?.label || "Room",
    items: (Array.isArray(room?.objects) ? room.objects : [])
      // Anything the customer deselected is not work, and anything still
      // awaiting confirmation is not work either until they say so.
      .filter((object) => object?.selected !== false && object?.needsConfirmation !== true)
      .map((object) => ({
        code: String(object?.inventoryKey || object?.code || "").trim(),
        label: String(object?.label || object?.name || "Task").slice(0, 80)
      }))
  }));
  return {
    serviceType: options.serviceType || "standard",
    frequency: options.frequency || "one-time",
    rooms,
    addOns: Array.isArray(options.addOns) ? options.addOns : []
  };
}
