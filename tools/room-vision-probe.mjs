import Anthropic from "@anthropic-ai/sdk";
import { instructions, selectionInstructions } from "../src/marketplace/room-vision.mjs";

// Measures the two things about the room reader that cannot be settled by
// reading the code: how large each instruction block actually is, and whether
// that clears the prompt-cache minimum for the model it is sent to.
//
// This matters because a prefix below the minimum is not an error. The request
// succeeds, `cache_control` is accepted, and nothing caches — the only symptom
// is `cache_read_input_tokens` sitting at zero while the bill stays flat. The
// minimum is also not monotonic across tiers: it is lower on the dearer models,
// so the cheap tier is the one at risk.
//
//   ANTHROPIC_API_KEY=sk-... node tools/room-vision-probe.mjs
//
// Read-only: it counts tokens and reads model metadata. It sends no photograph
// and runs no inference, so it costs nothing beyond the metadata calls.

// Published minimum cacheable prefix, in tokens, by model. A prompt shorter
// than its model's entry silently will not cache.
const cacheMinimums = Object.freeze({
  "claude-opus-5": 512,
  "claude-fable-5": 512,
  "claude-mythos-5": 512,
  "claude-opus-4-8": 1024,
  "claude-sonnet-5": 1024,
  "claude-sonnet-4-6": 1024,
  "claude-opus-4-7": 2048,
  "claude-opus-4-6": 4096,
  "claude-opus-4-5": 4096,
  "claude-haiku-4-5": 4096
});

const walkingModel = String(process.env.ROOM_VISION_MODEL || "claude-haiku-4-5").trim();
const confirmationModel = String(process.env.ROOM_VISION_CONFIRMATION_MODEL || "claude-sonnet-5").trim();

const apiKey = String(process.env.ANTHROPIC_API_KEY || "").trim();
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is required. This probe reads model metadata and counts tokens; it runs no inference.");
  process.exit(1);
}

const client = new Anthropic({ apiKey });

// The blocks are arrays of lines joined at the call site; join them the same way
// so the measurement is of the bytes actually sent, not an approximation.
const asText = (block) => (Array.isArray(block) ? block.join("\n") : String(block));
const prompts = [
  { name: "readRoom (walking + confirmation)", model: walkingModel, text: asText(instructions) },
  { name: "readRoom (confirmation tier)", model: confirmationModel, text: asText(instructions) },
  { name: "readSelection (confirmation only)", model: confirmationModel, text: asText(selectionInstructions) }
];

async function describeModel(id) {
  try {
    const model = await client.models.retrieve(id);
    const caps = model.capabilities || {};
    return {
      id: model.id,
      displayName: model.display_name,
      contextWindow: model.max_input_tokens,
      maxOutput: model.max_tokens,
      vision: caps.image_input?.supported === true,
      effort: caps.effort?.high?.supported === true,
      // The whole reason the confirmation read moved tiers. Not every build of
      // the API reports a resolution ceiling; when it is absent, say so rather
      // than inferring one.
      imageDetail: caps.image_input ? JSON.stringify(caps.image_input) : "(not reported)"
    };
  } catch (error) {
    return { id, error: error?.message || String(error) };
  }
}

console.log("=== models ===");
for (const id of [...new Set([walkingModel, confirmationModel])]) {
  const model = await describeModel(id);
  if (model.error) {
    console.log(`${id}: could not read metadata — ${model.error}`);
    continue;
  }
  console.log(`${model.id} (${model.displayName})`);
  console.log(`  context ${model.contextWindow} in / ${model.maxOutput} out · vision ${model.vision} · effort ${model.effort}`);
  console.log(`  image_input capability: ${model.imageDetail}`);
}

console.log("\n=== instruction blocks vs prompt-cache minimum ===");
let anyUncached = false;
for (const prompt of prompts) {
  const counted = await client.messages.countTokens({
    model: prompt.model,
    system: [{ type: "text", text: prompt.text }],
    messages: [{ role: "user", content: "x" }]
  });
  const minimum = cacheMinimums[prompt.model];
  const tokens = counted.input_tokens;
  const verdict = minimum === undefined
    ? "minimum unknown for this model — check the docs"
    : tokens >= minimum
      ? `caches (>= ${minimum})`
      : `WILL NOT CACHE — ${minimum - tokens} tokens short of ${minimum}`;
  if (minimum !== undefined && tokens < minimum) anyUncached = true;
  console.log(`${prompt.name}`);
  console.log(`  ${prompt.model}: ${tokens} tokens → ${verdict}`);
}

if (anyUncached) {
  console.log("\nAt least one prompt is below its model's minimum, so its cache_control is inert.");
  console.log("Options: move that read to a tier with a lower minimum, or lengthen the shared prefix.");
} else {
  console.log("\nEvery instruction block clears its model's minimum.");
}
console.log("\nConfirm in production with usage.cache_read_input_tokens on the second and later reads —");
console.log("a zero there across repeated scans means something in the prefix is varying per request.");
