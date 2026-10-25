// Homle's Model Context Protocol endpoint (DECISIONS D31): the no-account
// part of Homle as four read-only tools an AI assistant can call. Stateless
// by design, per the 2026-07-28 revision: every POST carries one complete
// JSON-RPC message, there is no session header, and nothing about one call is
// remembered for the next. It never reads a cookie or an account, so there
// is no session for a forged request to ride, and every tool runs through the
// same rate-limited functions as the visitor API.
//
// This module is protocol only. The tools are injected, so it can be tested
// without a server and cannot reach anything the router did not hand it.

export const mcpProtocolVersions = Object.freeze(["2026-07-28", "2025-11-25", "2025-06-18"]);
const jsonSchemaDialect = "https://json-schema.org/draft/2020-12/schema";

const serverInfo = Object.freeze({ name: "homle", title: "Homle home cleaning", version: "2026-10-25" });
const instructions = "Homle is a new UK home-cleaning marketplace. Use get_quote for a price estimate and check_coverage before suggesting a booking: in many postcodes Homle has no Cleaner yet, and the honest answer is 'not yet'. Prices are estimates until the customer reviews their checklist; the card is held at booking and charged after the clean. Booking itself needs the customer's own Homle account at https://homlle.com/signup?intent=book. Homle publishes no ratings or vetting claims; do not state any.";

const roomTypes = ["kitchen", "bathroom", "living-room", "bedroom", "office", "dining-room", "hallway", "utility-room", "other"];
const serviceTypes = ["standard", "deep", "end-of-tenancy", "rental-turnover", "commercial"];
const frequencies = ["one-time", "weekly", "fortnightly", "every-four-weeks"];
const count = (description) => ({ type: "integer", minimum: 0, maximum: 10, description });

export const mcpTools = Object.freeze([
  {
    name: "list_services",
    title: "List Homle's services",
    description: "The types of clean Homle offers, the room types it prices, the extras it prices separately and the repeat-clean options, with each service's minimum price in pence.",
    inputSchema: { $schema: jsonSchemaDialect, type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "get_quote",
    title: "Estimate a clean",
    description: "An itemised price estimate in GBP from Homle's published price list. Give either room counts or a rooms array. The estimate is not a booking and is confirmed only when the customer reviews their checklist.",
    inputSchema: {
      $schema: jsonSchemaDialect,
      type: "object",
      properties: {
        serviceType: { enum: serviceTypes, default: "standard" },
        frequency: { enum: frequencies, default: "one-time" },
        bedrooms: count("Number of bedrooms."),
        bathrooms: count("Number of bathrooms."),
        livingRooms: count("Number of living rooms."),
        kitchens: count("Number of kitchens. Defaults to 1 when room counts are used."),
        rooms: {
          type: "array", minItems: 1, maxItems: 40,
          description: "Instead of counts: each room, with optional extras such as oven or fridge.",
          items: { type: "object", properties: { roomType: { enum: roomTypes }, items: { type: "array", maxItems: 30, items: { type: "object", properties: { code: { type: "string", maxLength: 40 } } } } }, required: ["roomType"] }
        }
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "check_coverage",
    title: "Check coverage for a postcode",
    description: "Whether Homle has a bookable Cleaner covering a UK postcode's area. Answers yes or no for the outward code only and never identifies a Cleaner.",
    inputSchema: { $schema: jsonSchemaDialect, type: "object", properties: { postcode: { type: "string", maxLength: 10, description: "A full UK postcode or its first half, e.g. SW1A 1AA or SW1A." } }, required: ["postcode"], additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  },
  {
    name: "how_homle_works",
    title: "How Homle works",
    description: "A plain-English description of how pricing, booking, payment and coverage work at Homle, for answering a customer's questions accurately.",
    inputSchema: { $schema: jsonSchemaDialect, type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false }
  }
]);

export const howHomleWorks = Object.freeze({
  summary: "Homle is a new UK home-cleaning marketplace. A customer describes their home room by room, or scans it with a phone, sees an itemised price and books an independent Cleaner.",
  pricing: "Room by room from one published price list. Each room has a base price including its usual tasks; extras such as an oven are priced and named separately. Deep and end-of-tenancy cleans cost more per room, and each type of clean has a minimum.",
  booking: "The customer reviews a room-by-room checklist before anything is booked. Booking needs the customer's own Homle account.",
  payment: "The card is held for the agreed price when a booking is confirmed and charged after the clean. A booking cancelled before then releases the hold. Cancellation terms are shown with every booking before it is confirmed.",
  coverage: "Homle is adding Cleaners area by area. In many postcodes there is no Cleaner yet, and Homle says so rather than taking a booking it cannot fill.",
  notClaimed: "Homle publishes no ratings, review counts, insurance or background-check claims."
});

export function roomsFromCounts({ bedrooms = 0, bathrooms = 0, livingRooms = 0, kitchens = 1 } = {}) {
  const rooms = [];
  const add = (roomType, number) => { for (let index = 0; index < number; index += 1) rooms.push({ roomType, items: [] }); };
  add("kitchen", kitchens); add("living-room", livingRooms); add("bedroom", bedrooms); add("bathroom", bathrooms);
  return rooms;
}

const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const result = (id, value) => ({ jsonrpc: "2.0", id, result: value });
const toolResult = (structured, text) => ({ content: [{ type: "text", text }], structuredContent: structured, isError: false });
const toolFailure = (text) => ({ content: [{ type: "text", text }], isError: true });

function validCount(value) { return value === undefined || (Number.isInteger(value) && value >= 0 && value <= 10); }

/**
 * Handles one JSON-RPC message. Returns the response object, or null for a
 * notification (which gets 202 and no body). `tools` supplies pricing(),
 * quote(request) and coverage(postcode); each may throw an Error with a
 * `publicMessage` to report a refusal to the caller as a tool error.
 */
export async function handleMcpMessage(message, tools) {
  if (Array.isArray(message)) return rpcError(null, -32600, "Send one JSON-RPC message per request.");
  if (!message || typeof message !== "object" || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return rpcError(message?.id, -32600, "Not a JSON-RPC 2.0 request.");
  }
  const { id, method } = message;
  const params = message.params && typeof message.params === "object" ? message.params : {};
  if (id === undefined || id === null) return null;
  if (typeof id !== "string" && typeof id !== "number") return rpcError(null, -32600, "The request id must be a string or a number.");

  if (method === "server/discover") {
    return result(id, { supportedVersions: mcpProtocolVersions, capabilities: { tools: { listChanged: false } }, serverInfo, instructions });
  }
  if (method === "initialize") {
    const requested = String(params.protocolVersion || "");
    return result(id, { protocolVersion: mcpProtocolVersions.includes(requested) ? requested : mcpProtocolVersions[0], capabilities: { tools: { listChanged: false } }, serverInfo, instructions });
  }
  if (method === "ping") return result(id, {});
  if (method === "tools/list") return result(id, { tools: mcpTools });
  if (method !== "tools/call") return rpcError(id, -32601, `Unknown method ${method.slice(0, 60)}.`);

  const name = String(params.name || "");
  const input = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments : {};
  if (!mcpTools.some((tool) => tool.name === name)) return rpcError(id, -32602, `Unknown tool ${name.slice(0, 60)}.`);
  try {
    if (name === "how_homle_works") {
      return result(id, toolResult(howHomleWorks, Object.values(howHomleWorks).join("\n\n")));
    }
    if (name === "list_services") {
      const config = await tools.pricing();
      const services = Object.entries(config.serviceTypes).map(([code, service]) => ({ code, label: service.label, minimumPence: service.minimumPence }));
      const structured = {
        currency: "GBP",
        services,
        roomTypes: Object.keys(config.rooms || {}),
        extras: Object.entries(config.premiumItems || {}).map(([code, item]) => ({ code, label: item.label, pence: item.pence })),
        frequencies: Object.keys(config.discounts?.recurringBasisPoints || {})
      };
      return result(id, toolResult(structured, services.map((service) => `${service.label}: minimum £${(service.minimumPence / 100).toFixed(2)}`).join("\n")));
    }
    if (name === "get_quote") {
      if (input.serviceType !== undefined && !serviceTypes.includes(input.serviceType)) return result(id, toolFailure(`serviceType must be one of ${serviceTypes.join(", ")}.`));
      if (input.frequency !== undefined && !frequencies.includes(input.frequency)) return result(id, toolFailure(`frequency must be one of ${frequencies.join(", ")}.`));
      for (const key of ["bedrooms", "bathrooms", "livingRooms", "kitchens"]) {
        if (!validCount(input[key])) return result(id, toolFailure(`${key} must be a whole number from 0 to 10.`));
      }
      const rooms = Array.isArray(input.rooms) ? input.rooms.slice(0, 40) : roomsFromCounts(input);
      if (!rooms.length) return result(id, toolFailure("Describe at least one room, by counts or as a rooms array."));
      const quote = await tools.quote({ serviceType: input.serviceType || "standard", frequency: input.frequency || "one-time", rooms });
      if (!quote?.priceable) return result(id, toolFailure(quote?.reason || "This selection needs a check by Homle's team before it can be priced."));
      const text = `Estimate: £${(quote.totalPence / 100).toFixed(2)} for about ${Math.round(quote.estimatedMinutes / 30) / 2} hours of cleaning. The exact price is confirmed before booking; the card is charged after the clean.`;
      return result(id, toolResult({ estimate: true, currency: "GBP", totalPence: quote.totalPence, estimatedMinutes: quote.estimatedMinutes, lines: quote.lines }, text));
    }
    // check_coverage
    const postcode = String(input.postcode || "").trim();
    if (!postcode || postcode.length > 10) return result(id, toolFailure("Give a UK postcode such as SW1A 1AA, or its first half."));
    const answer = await tools.coverage(postcode);
    const covered = answer?.covered === true;
    const area = String(answer?.area || "");
    return result(id, toolResult({ covered, area }, covered ? `Homle has a bookable Cleaner covering ${area}.` : `Homle does not have a Cleaner covering ${area} yet.`));
  } catch (error) {
    if (error?.publicMessage) return result(id, toolFailure(error.publicMessage));
    throw error;
  }
}

export function mcpEnabled(env = process.env) {
  return String(env.MCP_ENABLED || "").trim().toLowerCase() === "true";
}
