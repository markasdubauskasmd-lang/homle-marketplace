import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { defaultPricingConfig, normalizedPricingConfig } from "../public/pricing-config.js";
import { quoteRooms } from "../public/pricing-engine.js";
import { pricingRequestFromManualTasks } from "../public/landlord-dashboard-model.js";

// The three "Recommended for you" figures are typed by hand, and nothing has
// ever compared them to the price list they claim to preview.
//
// They are labelled INDICATIVE and "not a quote", which is honest and is why
// they are allowed to differ from a real basket at all. What is not honest is
// drifting silently: the price list is configuration, so a rate change moves
// every real quote in the product while these three strings stay exactly where
// they were until somebody notices.
//
// So this does not assert the figures are right — that is a commercial choice,
// not a test's. It records what the engine currently charges for the basket
// each card describes IN ITS OWN SUBTITLE, and fails the moment that moves.
// The failure names both numbers, so whoever changes the price list is told
// which headline figures now misrepresent it and by how much.

const config = normalizedPricingConfig(defaultPricingConfig);
const script = await readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8");

/* Baskets read from the card subtitles, not invented: "Living room, kitchen,
   bathroom", "Detailed kitchen and bathroom refresh", "Full property clean". */
const CARDS = [
  { name: "Standard clean", cleaningType: "regular-domestic", rooms: ["Living room", "Kitchen", "Bathroom"], enginePence: 5600 },
  { name: "Deep clean", cleaningType: "deep-cleans", rooms: ["Kitchen", "Bathroom"], enginePence: 12000 },
  { name: "End of tenancy", cleaningType: "end-of-tenancy", rooms: ["Living room", "Kitchen", "Bathroom", "Bedroom", "Hallway"], enginePence: 15000 }
];

const money = (pence) => `£${(pence / 100).toFixed(2)}`;

for (const card of CARDS) {
  /* The shown figure is read out of the shipped module rather than duplicated
     here, so editing the card and forgetting this file is not possible. */
  const shown = new RegExp(`name: "${card.name}"[^}]*?from: "£(\\d+)"`).exec(script);
  assert.ok(shown, `The "${card.name}" guide card is no longer declared with a "from" price in landlord-dashboard.js, so its figure can no longer be checked against the price list.`);
  const shownPence = Number(shown[1]) * 100;

  const tasks = card.rooms.map((roomName) => ({ roomName, description: `clean the ${roomName.toLowerCase()}`, sortOrder: 0 }));
  const quote = quoteRooms(pricingRequestFromManualTasks(tasks, { cleaningType: card.cleaningType, frequency: "one-time" }), config);

  assert.ok(quote.priceable, `The price list can no longer price the basket "${card.name}" advertises (${card.rooms.join(", ")}): ${quote.reason}.`);
  assert.equal(
    quote.totalPence,
    card.enginePence,
    `The price list now charges ${money(quote.totalPence)} for the basket the "${card.name}" card describes (${card.rooms.join(", ")}), not the ${money(card.enginePence)} recorded here. The card still advertises "From ${money(shownPence)}", which is now ${shownPence >= quote.totalPence ? "above" : "BELOW"} the real price by ${Math.abs(Math.round(((shownPence - quote.totalPence) / quote.totalPence) * 100))}%. Update the card, or update this record if the gap is intended.`
  );
}

/* Stated once, out loud, because it is the part a reader should not have to
   rediscover: these figures are not derived from anything. */
assert.ok(
  CARDS.every((card) => new RegExp(`from: "£\\d+"`).test(script)),
  "The guide prices are no longer literal strings; if they are computed now, this file should compare the computation instead."
);

const summary = CARDS.map((card) => {
  const shown = Number(new RegExp(`name: "${card.name}"[^}]*?from: "£(\\d+)"`).exec(script)[1]) * 100;
  const gap = Math.round(((shown - card.enginePence) / card.enginePence) * 100);
  return `${card.name} shows ${money(shown)} against ${money(card.enginePence)} (${gap >= 0 ? "+" : ""}${gap}%)`;
}).join("; ");

console.log(`Landlord guide-price tests passed: the three indicative figures are hand-written and are held against the live price list — ${summary}. A rate change now fails here instead of drifting unnoticed.`);
