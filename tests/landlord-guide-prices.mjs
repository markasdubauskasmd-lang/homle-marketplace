import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { defaultPricingConfig, normalizedPricingConfig } from "../public/pricing-config.js";
import { quoteRooms } from "../public/pricing-engine.js";
import { pricingRequestFromManualTasks } from "../public/landlord-dashboard-model.js";

// The three "Recommended for you" figures used to be typed by hand, and nothing
// compared them to the price list they claim to preview.
//
// By the time anyone checked they had drifted in both directions: Standard
// advertised "From £68" against a real £56, End of tenancy "From £185" against
// £150, and — the dangerous one — Deep advertised "From £112" against a real
// £120, which is a headline promising less than the product charges.
//
// They are derived now. This file's job is to keep them that way: it asserts
// that the card array declares a BASKET rather than a price, that the basket
// matches the words in the card's own subtitle, and that what the engine
// charges for it is a number the card can honestly show.

const config = normalizedPricingConfig(defaultPricingConfig);
const script = await readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8");

/* Baskets read from the card subtitles, not invented: "Living room, kitchen,
   bathroom", "Detailed kitchen and bathroom refresh", "Full property clean". */
const CARDS = [
  { name: "Standard clean", cleaningType: "regular-domestic", rooms: ["Living room", "Kitchen", "Bathroom"] },
  { name: "Deep clean", cleaningType: "deep-cleans", rooms: ["Kitchen", "Bathroom"] },
  { name: "End of tenancy", cleaningType: "end-of-tenancy", rooms: ["Living room", "Kitchen", "Bathroom", "Bedroom", "Hallway"] }
];

const money = (pence) => `£${(pence / 100).toFixed(2)}`;
const summary = [];

for (const card of CARDS) {
  /* The basket is read out of the shipped module rather than duplicated here,
     so editing the card and forgetting this file is not possible. */
  const declared = new RegExp(`name: "${card.name}"[^}]*?basket: Object\\.freeze\\(\\[([^\\]]*)\\]\\)`).exec(script);
  assert.ok(declared, `The "${card.name}" guide card no longer declares a basket in landlord-dashboard.js, so its figure can no longer be checked against the price list.`);
  const declaredRooms = [...declared[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(
    declaredRooms,
    card.rooms,
    `The "${card.name}" card now advertises a different basket (${declaredRooms.join(", ")}) from the one its subtitle describes (${card.rooms.join(", ")}).`
  );

  const tasks = card.rooms.map((roomName) => ({ roomName, description: `clean the ${roomName.toLowerCase()}`, sortOrder: 0 }));
  const quote = quoteRooms(pricingRequestFromManualTasks(tasks, { cleaningType: card.cleaningType, frequency: "one-time" }), config);

  assert.ok(quote.priceable, `The price list can no longer price the basket "${card.name}" advertises (${card.rooms.join(", ")}): ${quote.reason}.`);
  /* A guide price is shown as whole pounds. Rounding DOWN would advertise below
     the real price, which is the failure that made this file necessary. */
  const shownPence = Math.round(quote.totalPence / 100) * 100;
  assert.ok(
    shownPence >= quote.totalPence,
    `The "${card.name}" card would advertise ${money(shownPence)} against a real price of ${money(quote.totalPence)}. A guide price must never sit below what the product charges.`
  );
  summary.push(`${card.name} £${Math.round(quote.totalPence / 100)}`);
}

/* Stated once, out loud, because it is the part a reader should not have to
   rediscover: these figures are no longer literals and must not become literals
   again. */
assert.ok(
  !/from: "£\d+"/.test(script),
  "A guide price has been hard-coded back into landlord-dashboard.js. Derive it from the price list instead."
);
assert.ok(
  script.includes("indicativePlanPrice"),
  "The derivation helper is gone from landlord-dashboard.js, so the guide prices are no longer computed from the engine."
);

console.log(`Landlord guide prices are derived from the price list, never below it, and match the baskets their own subtitles describe: ${summary.join(", ")}.`);
