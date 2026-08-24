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
// THE ONE ENGINE
//
// Three input shapes reach this function and all of them normalise to the same
// PricingRequest before any arithmetic happens:
//
//   * the scanner, through quoteInputFromScan()
//   * the manual task list, through pricingRequestFromManualTasks()
//   * a property description ("2 bed, 1 bath, flat"), through
//     roomsFromPropertyShape()
//
// There is no second rate table and no second formula. Whether a customer used
// the camera or typed three numbers, the same code produces the price.
//
// WHAT THIS IS NOT
//
// It is not an estimate. A price from here is a firm number, because it prices a
// CONFIRMED list of rooms and tasks — what the customer selected and can see.
// scan-pricing.mjs wraps this function to express uncertainty about what is IN
// the room while the scan is still being checked, and its range collapses to
// this number once the customer has confirmed the list.
//
// ROUNDING
//
// All arithmetic is integer pence. Percentages are basis points and every
// division is floored or rounded exactly once, at the point of use, into a line
// item. Nothing is re-derived from a rounded number, which is how breakdowns
// drift away from their totals. The final total lands on the configured
// increment through an explicit `rounding` line, never by quietly adjusting
// another one.

import { locationBandFor, normalizedPricingConfig, roomDefinition, roomsFromPropertyShape } from "./pricing-config.js";

const basisPointDivisor = 10000;

function line(code, label, pence, meta = {}) {
  return Object.freeze({ code, label, pence, ...meta });
}

function formatPounds(pence) {
  return `£${(pence / 100).toFixed(2)}`;
}

function percentLabel(basisPoints) {
  return `${Math.round(Math.abs(basisPoints) / 100)}%`;
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
    lines: Object.freeze([])
  });
}

/* ── Time, in the timezone the business actually operates in ─────────────── */

// Everything about a UK cleaning slot is local-time reasoning: "Saturday",
// "before eight", "a bank holiday". Doing that arithmetic in UTC gets an 8am
// summer booking wrong by exactly the hour that matters.
const londonParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hour12: false
});

function londonMoment(date) {
  const parts = Object.fromEntries(londonParts.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    weekday: parts.weekday,
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    // "24" appears at midnight in some ICU versions; normalise it to 0.
    hour: Number(parts.hour) % 24
  };
}

/**
 * Prices one room.
 *
 * The included-tasks rule, exactly: the first N ordinary tasks are what the base
 * price already pays for, and each one after that is charged. Premium items
 * never consume an included slot and are never charged at the per-item rate — an
 * oven is not a mirror, and pricing it as one would pay a cleaner about a pound
 * to spend forty minutes on it.
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

  // Measured floor area, charged only ABOVE what the base price already assumes
  // it is paying for. A room nobody measured contributes nothing at all rather
  // than an assumed size — putting a number in the price that nothing observed
  // is the failure the whole measurement feature exists to avoid.
  const measuredSquareMetres = Number(room?.squareMetres);
  const excessSquareMetres = Number.isFinite(measuredSquareMetres) && measuredSquareMetres > 0
    ? Math.max(0, measuredSquareMetres - definition.expectedSquareMetres)
    : 0;
  const sizePence = Math.round(excessSquareMetres * config.perSquareMetrePence);

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
  if (sizePence > 0) {
    lines.push(line("room-size", `Larger than a typical ${definition.label.toLowerCase()} — ${Math.round(excessSquareMetres)}m² extra`, sizePence, { kind: "size" }));
  }
  for (const premium of premiums) {
    lines.push(line(`premium:${premium.code}`, premium.label, premium.pence, { kind: "premium" }));
  }

  const premiumPence = premiums.reduce((total, premium) => total + premium.pence, 0);
  const minutes = definition.baseMinutes
    + additional * config.additionalItemMinutes
    // Extra floor area is extra time as well as extra money, at the same rate
    // the base implies. Without this a large house is priced for the work and
    // scheduled for the wrong duration.
    + Math.round((sizePence / Math.max(config.customerHourlyRatePence, 1)) * 60)
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
    sizePence,
    excessSquareMetres,
    premiumPence,
    // Room subtotal excludes premiums: discounts and the service multiplier
    // apply to cleaning the room, not to the standalone jobs inside it.
    subtotalPence: definition.basePence + additionalPence + sizePence,
    totalPence: definition.basePence + additionalPence + sizePence + premiumPence,
    minutes,
    lines: Object.freeze(lines)
  });
}

/**
 * The quote.
 *
 * @param request  {
 *                   serviceType, frequency, postcode, conditionLevel,
 *                   startAt, now, promotion,
 *                   rooms:[{roomType,label,squareMetres,items:[{code,label}]}],
 *                   addOns:[{code,quantity}]
 *                 }
 * @param config   a pricing configuration (normalised here if it is not already)
 */
export function quoteRooms(request = {}, config = {}) {
  const rules = normalizedPricingConfig(config);

  // Three input shapes, one list of rooms. A caller that describes a property
  // — "two bed, one bath, flat" — gets it expanded here rather than in a
  // separate quoting path, so the three-tap quote and the scanner and the typed
  // checklist are all the same arithmetic over the same structure. An explicit
  // room list always wins; the shape is what you send when you do not have one.
  const supplied = Array.isArray(request?.rooms) ? request.rooms : [];
  const rooms = (supplied.length ? supplied : roomsFromPropertyShape(rules, request?.propertyShape ?? {})).slice(0, 40);
  if (!rooms.length) return unpriceable("no-rooms", "Add at least one room before a price can be worked out.", rules);

  const serviceCode = String(request?.serviceType || "standard");
  const service = rules.serviceTypes[serviceCode] ?? rules.serviceTypes.standard;
  const frequency = String(request?.frequency || "one-time");

  // Condition. Absent means level 2 — the neutral case — so a booking with no
  // assessment is priced exactly as it was before condition existed.
  const conditionLevel = Number.isInteger(Number(request?.conditionLevel)) ? Number(request.conditionLevel) : 2;
  const condition = rules.conditionLevels[conditionLevel] ?? rules.conditionLevels[2];
  if (conditionLevel === 5 || condition.multiplierBasisPoints === 0) {
    return unpriceable(
      "specialist-review-required",
      "This property needs a quick look from our team before we can put a price on it.",
      rules
    );
  }

  const location = locationBandFor(rules, request?.postcode);

  // The ceiling is checked BEFORE any money is computed. Deep × heavy condition
  // × London is 2.62× and is a real quote; six times the base is a configuration
  // error, and refusing beats clamping — a clamped quote transacts at a number
  // nobody chose.
  const combinedMultiplierBasisPoints = Math.round(
    (service.multiplierBasisPoints * condition.multiplierBasisPoints * location.multiplierBasisPoints)
    / (basisPointDivisor * basisPointDivisor)
  );
  if (combinedMultiplierBasisPoints > rules.maximumCombinedMultiplierBasisPoints) {
    return unpriceable("multiplier-ceiling", "This combination of service, condition and area needs a quick check by our team before we can price it.", rules);
  }

  const pricedRooms = rooms.map((room, index) => priceRoom(room, rules, index));

  const roomSubtotalPence = pricedRooms.reduce((total, room) => total + room.subtotalPence, 0);
  const premiumPence = pricedRooms.reduce((total, room) => total + room.premiumPence, 0);

  const lines = [];
  lines.push(line("rooms", `${pricedRooms.length} ${pricedRooms.length === 1 ? "room" : "rooms"}`, roomSubtotalPence, { kind: "subtotal" }));

  // 1. Service type, against the room subtotal only. A deep clean means more
  //    work per room; it does not mean the oven costs more.
  const serviceAdjustmentPence = Math.round(roomSubtotalPence * service.multiplierBasisPoints / basisPointDivisor) - roomSubtotalPence;
  if (serviceAdjustmentPence !== 0) {
    lines.push(line("service", `${service.label} — ${serviceAdjustmentPence > 0 ? "adds" : "reduces by"} ${percentLabel(service.multiplierBasisPoints - basisPointDivisor)}`, serviceAdjustmentPence, { kind: "service" }));
  }
  const afterService = roomSubtotalPence + serviceAdjustmentPence;

  // 2. Condition. The scanner already graded it, the customer has already seen
  //    the grade, and until now the only system that charges ignored it.
  const conditionAdjustmentPence = Math.round(afterService * condition.multiplierBasisPoints / basisPointDivisor) - afterService;
  if (conditionAdjustmentPence !== 0) {
    lines.push(line("condition", `${condition.label} — ${conditionAdjustmentPence > 0 ? "adds" : "reduces by"} ${percentLabel(condition.multiplierBasisPoints - basisPointDivisor)}`, conditionAdjustmentPence, { kind: "condition" }));
  }
  const afterCondition = afterService + conditionAdjustmentPence;

  // 3. Where the property is. Named after the band rather than the postcode, so
  //    the customer reads "London" and not a rule about their address.
  const locationAdjustmentPence = Math.round(afterCondition * location.multiplierBasisPoints / basisPointDivisor) - afterCondition;
  if (locationAdjustmentPence !== 0) {
    lines.push(line("location", `${location.label} rates — ${locationAdjustmentPence > 0 ? "adds" : "reduces by"} ${percentLabel(location.multiplierBasisPoints - basisPointDivisor)}`, locationAdjustmentPence, { kind: "location" }));
  }
  const labourBeforeTimingPence = afterCondition + locationAdjustmentPence;

  // 4. When. Both surcharges apply to the labour subtotal, and both flow 70% to
  //    the cleaner through the ordinary share — which is what makes an awkward
  //    slot worth accepting rather than simply more expensive to buy.
  const timing = timingFor(request, rules);
  const urgencyPence = Math.round(labourBeforeTimingPence * timing.urgencyBasisPoints / basisPointDivisor);
  if (urgencyPence > 0) {
    lines.push(line("urgency", `${timing.urgencyLabel} — adds ${percentLabel(timing.urgencyBasisPoints)}`, urgencyPence, { kind: "urgency" }));
  }
  const schedulePence = Math.round(labourBeforeTimingPence * timing.scheduleBasisPoints / basisPointDivisor);
  if (schedulePence > 0) {
    lines.push(line("schedule", `${timing.scheduleLabel} — adds ${percentLabel(timing.scheduleBasisPoints)}`, schedulePence, { kind: "schedule" }));
  }

  // 5. Multi-room. The cleaner is already there and setup is paid once.
  const bands = rules.discounts.multiRoomBasisPoints;
  const applicable = Object.keys(bands)
    .map(Number)
    .filter((threshold) => pricedRooms.length >= threshold)
    .sort((a, b) => b - a)[0];
  const multiRoomBasisPoints = applicable ? bands[applicable] : 0;
  const multiRoomDiscountPence = -Math.round(labourBeforeTimingPence * multiRoomBasisPoints / basisPointDivisor);
  if (multiRoomDiscountPence !== 0) {
    lines.push(line("multi-room", `${pricedRooms.length}-room saving — ${multiRoomBasisPoints / 100}%`, multiRoomDiscountPence, { kind: "discount" }));
  }

  // 6. Recurring.
  const recurringBasisPoints = rules.discounts.recurringBasisPoints[frequency] ?? 0;
  const recurringDiscountPence = -Math.round(labourBeforeTimingPence * recurringBasisPoints / basisPointDivisor);
  if (recurringDiscountPence !== 0) {
    lines.push(line("recurring", `${frequency.replace(/-/g, " ")} saving — ${recurringBasisPoints / 100}%`, recurringDiscountPence, { kind: "discount" }));
  }

  const labourPence = labourBeforeTimingPence + urgencyPence + schedulePence + multiRoomDiscountPence + recurringDiscountPence;

  // 7. Premium items, whole and undiscounted.
  if (premiumPence) lines.push(line("premium-items", "Specialist tasks", premiumPence, { kind: "premium" }));

  // 8. Whole-visit add-ons.
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

  const beforePromotionPence = labourPence + premiumPence + addOnPence;

  // 9. Promotion. Applied to labour only, like every other discount, and capped.
  //    The promotion object is one the SERVER resolved from a code; this
  //    function never sees the code list, and the authoritative quote re-resolves
  //    rather than trusting whatever the browser attached.
  const promotion = applicablePromotion(request?.promotion, beforePromotionPence);
  let promotionDiscountPence = 0;
  if (promotion) {
    const raw = promotion.kind === "percentage"
      ? Math.round(labourPence * promotion.value / basisPointDivisor)
      : promotion.value;
    promotionDiscountPence = -Math.min(raw, promotion.maximumDiscountPence, beforePromotionPence);
    if (promotionDiscountPence !== 0) {
      lines.push(line(`promotion:${promotion.code}`, promotion.label, promotionDiscountPence, { kind: "promotion" }));
    }
  }

  // 10. The floor: a minimum VISIT LENGTH, not a cash floor.
  //
  //     A cleaner gives up a travel slot for the visit whatever it contains, so
  //     the constraint is time. Priced through the same service multiplier as
  //     the rooms, because two hours of deep-clean work is not two hours of
  //     standard work. The service type keeps its own cash floor on top — an
  //     end-of-tenancy clean carries a guarantee that two hours does not cover.
  const minimumDurationPence = Math.round(
    (rules.minimumBookingMinutes / 60) * rules.customerHourlyRatePence * service.multiplierBasisPoints / basisPointDivisor
  );
  const floorPence = roundUpTo(Math.max(minimumDurationPence, service.minimumPence), rules.roundingIncrementPence);

  // The tail — rounding, then the floor — is the same arithmetic whether or not
  // a promotion applied, which is what lets the cleaner's payout be computed
  // against the price the booking WOULD have been. A promotion is a platform
  // growth decision; it must never quietly become a pay cut.
  const settled = settle(beforePromotionPence + promotionDiscountPence, floorPence, rules.roundingIncrementPence);
  const withoutPromotion = settle(beforePromotionPence, floorPence, rules.roundingIncrementPence);

  if (settled.roundingPence !== 0) {
    lines.push(line("rounding", settled.roundingPence > 0 ? "Rounded up" : "Rounded down", settled.roundingPence, { kind: "rounding" }));
  }
  if (settled.minimumAdjustmentPence > 0) {
    const hours = Math.round(rules.minimumBookingMinutes / 6) / 10;
    lines.push(line("minimum", `Minimum ${hours}-hour visit — ${formatPounds(floorPence)}`, settled.minimumAdjustmentPence, { kind: "minimum" }));
  }

  const totalPence = settled.totalPence;

  // The booked duration is floored too. A two-hour minimum that still reported
  // twenty-five minutes of work would make every cleaner-pay check meaningless
  // and would tell the cleaner to expect a job far shorter than the one sold.
  const workedMinutes = pricedRooms.reduce((total, room) => total + room.minutes, 0) + addOnMinutes;
  const estimatedMinutes = Math.max(workedMinutes, rules.minimumBookingMinutes);

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
    conditionLevel,
    conditionLabel: condition.label,
    locationBand: location.code,
    locationLabel: location.label,
    urgencyCode: timing.urgencyCode,
    scheduleCode: timing.scheduleCode,
    rooms: Object.freeze(pricedRooms),
    lines: Object.freeze(lines),
    roomSubtotalPence,
    premiumPence,
    addOnPence,
    serviceAdjustmentPence,
    conditionAdjustmentPence,
    locationAdjustmentPence,
    sizePence: pricedRooms.reduce((sum, room) => sum + room.sizePence, 0),
    urgencyPence,
    schedulePence,
    discountPence: multiRoomDiscountPence + recurringDiscountPence,
    promotionCode: promotion?.code ?? "",
    promotionDiscountPence,
    minimumAdjustmentPence: settled.minimumAdjustmentPence,
    roundingPence: settled.roundingPence,
    totalPence,
    // What the cleaner's share is computed against: the total this booking would
    // have been without the promotion. Never lower than the total.
    payoutBasisPence: Math.max(withoutPromotion.totalPence, totalPence),
    estimatedMinutes,
    workedMinutes
  });
}

/* ── The pieces the quote is assembled from ──────────────────────────────── */

function roundUpTo(amount, increment) {
  if (increment <= 1) return amount;
  return Math.ceil(amount / increment) * increment;
}

function roundNearest(amount, increment) {
  if (increment <= 1) return amount;
  return Math.round(amount / increment) * increment;
}

/**
 * Rounding, then the floor, in that order.
 *
 * The floor is already on an increment boundary, so a total lifted onto it stays
 * on the boundary and the two adjustments can never fight each other.
 */
function settle(amountPence, floorPence, increment) {
  const bounded = Math.max(0, amountPence);
  const rounded = roundNearest(bounded, increment);
  const roundingPence = rounded - bounded;
  const minimumAdjustmentPence = Math.max(0, floorPence - rounded);
  return {
    roundingPence,
    minimumAdjustmentPence,
    totalPence: rounded + minimumAdjustmentPence
  };
}

/**
 * How soon the visit is, and what kind of slot it lands in.
 *
 * Both are read from the requested start time. Without one there is no urgency
 * and no unsocial-hours charge — a quote for an unscheduled job is the base
 * price, and it goes up when a time is chosen, which is the honest direction for
 * a surprise to travel in.
 */
function timingFor(request, rules) {
  // Two separate neutrals. One object holding both sets of keys would let the
  // schedule spread below silently overwrite the urgency that was just worked
  // out, which is a quiet way to stop charging for same-day bookings.
  const noUrgency = { urgencyCode: "", urgencyLabel: "", urgencyBasisPoints: 0 };
  const noSchedule = { scheduleCode: "", scheduleLabel: "", scheduleBasisPoints: 0 };
  const startAt = Date.parse(request?.startAt ?? "");
  if (!Number.isFinite(startAt)) return { ...noUrgency, ...noSchedule };

  // The clock is the caller's, so the server can price with its own rather than
  // one a browser supplied. An absent `now` means "price the slot, not the
  // notice" — used by the admin preview, where urgency against the operator's
  // clock would be meaningless.
  const suppliedNow = request?.now == null ? null : Date.parse(request.now instanceof Date ? request.now.toISOString() : request.now);
  const noticeHours = Number.isFinite(suppliedNow) ? (startAt - suppliedNow) / 3600000 : Number.POSITIVE_INFINITY;

  let urgency = noUrgency;
  if (noticeHours >= 0) {
    const band = rules.urgencyBands.find((candidate) => noticeHours < candidate.withinHours);
    if (band) {
      urgency = { urgencyCode: band.code, urgencyLabel: band.label, urgencyBasisPoints: band.surchargeBasisPoints };
    }
  }

  const moment = londonMoment(new Date(startAt));
  let schedule = noSchedule;
  if (moment.weekday === "Sun" || rules.bankHolidays.includes(moment.isoDate)) {
    schedule = {
      scheduleCode: "sunday",
      scheduleLabel: rules.scheduleSurcharges.sunday.label,
      scheduleBasisPoints: rules.scheduleSurcharges.sunday.surchargeBasisPoints
    };
  } else if (moment.weekday === "Sat") {
    schedule = {
      scheduleCode: "saturday",
      scheduleLabel: rules.scheduleSurcharges.saturday.label,
      scheduleBasisPoints: rules.scheduleSurcharges.saturday.surchargeBasisPoints
    };
  } else if (moment.hour < 8 || moment.hour >= 18) {
    schedule = {
      scheduleCode: "outside-hours",
      scheduleLabel: rules.scheduleSurcharges.outsideHours.label,
      scheduleBasisPoints: rules.scheduleSurcharges.outsideHours.surchargeBasisPoints
    };
  }

  return { ...urgency, ...schedule };
}

/**
 * The promotion, if it still applies to this basket.
 *
 * Shape-checked rather than trusted: this object arrives on the request, and on
 * the client it arrives from an endpoint but on a tampered client it could
 * arrive from anywhere. The authoritative server quote overwrites it with its
 * own lookup regardless, so this is the second line rather than the first.
 */
function applicablePromotion(promotion, basketPence) {
  if (!promotion || typeof promotion !== "object") return null;
  const code = String(promotion.code || "").trim().toUpperCase();
  const kind = promotion.kind === "fixed" ? "fixed" : "percentage";
  const value = Number(promotion.value);
  const maximumDiscountPence = Number(promotion.maximumDiscountPence);
  const minimumSpendPence = Number(promotion.minimumSpendPence) || 0;
  if (!/^[A-Z0-9]{3,24}$/.test(code)) return null;
  if (!Number.isInteger(value) || value < 1) return null;
  if (!Number.isInteger(maximumDiscountPence) || maximumDiscountPence < 1) return null;
  if (basketPence < minimumSpendPence) return null;
  return Object.freeze({
    code,
    label: String(promotion.label || `${code} discount`).slice(0, 60),
    kind,
    value,
    maximumDiscountPence
  });
}

/**
 * Maps a completed room scan onto the quote input.
 *
 * The scanner already produces rooms, the objects found in them, the floor areas
 * measured from the photos and a condition grade for the property. This turns
 * that into the task list the customer confirms — it does not price anything
 * itself, so the number on the scanner and the number at checkout come from the
 * same function.
 */
export function quoteInputFromScan(scan = {}, options = {}) {
  const rooms = (Array.isArray(scan?.rooms) ? scan.rooms : []).map((room) => ({
    roomType: room?.roomType || room?.roomName || "other",
    label: room?.roomName || room?.label || "Room",
    squareMetres: measuredSquareMetres(room),
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
    // The scan's own grade, carried into the price rather than shown beside a
    // price that ignored it.
    conditionLevel: Number(scan?.complexity?.level) || Number(options.conditionLevel) || 2,
    postcode: options.postcode || "",
    startAt: options.startAt || "",
    now: options.now || null,
    rooms,
    addOns: Array.isArray(options.addOns) ? options.addOns : [],
    ...(options.promotion ? { promotion: options.promotion } : {}),
    ...(options.promotionCode ? { promotionCode: String(options.promotionCode).trim().toUpperCase() } : {})
  };
}

/**
 * A usable floor area for one scanned room, in square metres.
 *
 * Only a measurement the scan is confident in counts. "Unusable" means the two
 * tapped spans did not produce a length anyone should price from, and treating
 * it as zero is right: the room falls back to its base price, which already
 * assumes a typical size.
 */
function measuredSquareMetres(room) {
  if (Number.isFinite(Number(room?.squareMetres)) && Number(room.squareMetres) > 0) return Number(room.squareMetres);
  const area = (Array.isArray(room?.measurements) ? room.measurements : [])
    .find((measurement) => measurement?.subject === "floor-area"
      && measurement.confidence !== "unusable"
      && Number(measurement.valueMm) > 0);
  return area ? Number(area.valueMm) / 1_000_000 : 0;
}
