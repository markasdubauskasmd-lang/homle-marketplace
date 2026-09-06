import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { services } from "../public/landlord-journey-model.js";
const script = await readFile(new URL("../public/landlord-dashboard.js", import.meta.url), "utf8");
const start = script.indexOf("const LD_INDICATIVE_PLANS =");
const end = script.indexOf("/* Cloned", start);
const context = vm.createContext({});
vm.runInContext(script.slice(start, end) + "\nthis.plans = LD_INDICATIVE_PLANS;", context);
assert.equal(context.plans.length, 3);
for (const plan of context.plans) {
  assert(services.some(service => service.code === plan.code), "A service card cannot open a supported cleaning journey.");
  assert(!Object.hasOwn(plan, "from"), "A service card still advertises an unverified starting price.");
  assert(plan.desc.length > 0);
}
const renderer = script.slice(script.indexOf("function renderIndicativePlans()"), script.indexOf("let careSummary"));
assert(renderer.includes("Get estimate"));
assert(!renderer.includes("plan.from"));
assert(renderer.includes("encodeURIComponent(plan.code)"));
console.log("Customer service cards: supported routes, scope-led estimates and no hand-written price claims passed.");
