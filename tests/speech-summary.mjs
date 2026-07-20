import { createAnthropicSpeechSummary, speechSummaryFromEnvironment } from "../src/marketplace/speech-summary.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function rejects(run, fragment) {
  try { await run(); } catch (error) { return String(error?.message || "").includes(fragment); }
  return false;
}

function stubClient(reply, capture = {}) {
  return {
    messages: {
      async create(request) {
        Object.assign(capture, { request });
        return typeof reply === "function" ? reply(request) : reply;
      }
    }
  };
}

const jsonReply = (payload) => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(payload) }] });

// The provider is optional. Absent configuration must leave the on-device
// parser as the only path rather than failing the runtime.
assert(speechSummaryFromEnvironment({}) === null, "An unconfigured speech summary provider was not treated as disabled.");
assert(speechSummaryFromEnvironment({ SPEECH_SUMMARY_PROVIDER: "off" }) === null, "An explicitly disabled speech summary provider was still constructed.");
assert(await rejects(async () => speechSummaryFromEnvironment({ SPEECH_SUMMARY_PROVIDER: "acme" }), "must be 'anthropic'"), "An unrecognised speech summary provider was accepted.");
assert(await rejects(async () => speechSummaryFromEnvironment({ SPEECH_SUMMARY_PROVIDER: "anthropic" }), "ANTHROPIC_API_KEY is required"), "The provider was enabled without the credential it needs.");

{
  const capture = {};
  const summary = createAnthropicSpeechSummary({
    apiKey: "test-key",
    client: stubClient(jsonReply({
      tasks: [
        { room: "Kitchen", task: "Degrease the worktops", excluded: false },
        { room: "Kitchen", task: "Clean inside the oven", excluded: true },
        { room: "", task: "Mop the floor", excluded: false }
      ]
    }), capture)
  });
  const lines = await summary.summarise("the worktops are greasy but don't clean inside the oven and mop the floor");

  // A refusal must never be published as an instruction to do the work.
  assert(lines.includes("Kitchen: Do not clean inside the oven"), `A spoken exclusion was not recorded as an exclusion: ${JSON.stringify(lines)}`);
  assert(lines.includes("Kitchen: Degrease the worktops") && lines.includes("Mop the floor"), `A task was lost or wrongly attributed: ${JSON.stringify(lines)}`);

  // The request must carry the walkthrough and nothing else about the customer.
  const request = capture.request;
  assert(request.model === "claude-opus-4-8", "The speech summary did not use the configured default model.");
  assert(request.output_config?.format?.type === "json_schema", "The summary was requested without a schema, so malformed output could reach the checklist.");
  // Only the spoken words may leave the deployment. The system prompt is our
  // own fixed text, so the check is scoped to the data half of the request.
  assert(request.messages.length === 1 && request.messages[0].role === "user", "The summary request carried more than the spoken walkthrough.");
  assert(request.messages[0].content === "the worktops are greasy but don't clean inside the oven and mop the floor", "The walkthrough sent to the provider was not exactly what the Landlord said.");
  assert(!("metadata" in request) && !("tools" in request), "The summary request carried fields beyond the walkthrough and its output shape.");
}

// A very long dictation must be bounded before it is sent.
{
  const capture = {};
  const summary = createAnthropicSpeechSummary({ apiKey: "test-key", client: stubClient(jsonReply({ tasks: [{ room: "", task: "Clean throughout", excluded: false }] }), capture) });
  await summary.summarise("kitchen ".repeat(5000));
  assert(capture.request.messages[0].content.length <= 5000, "An unbounded transcript was sent to the provider.");
}

// Every failure mode must be a clean throw so the caller can fall back to the
// on-device parser instead of showing the Landlord a broken checklist.
for (const [label, reply] of [
  ["a safety refusal", { stop_reason: "refusal", content: [] }],
  ["invalid JSON", { stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }],
  ["an empty task list", jsonReply({ tasks: [] })],
  ["unusable task text", jsonReply({ tasks: [{ room: "Kitchen", task: "x", excluded: false }] })]
]) {
  const summary = createAnthropicSpeechSummary({ apiKey: "test-key", client: stubClient(reply) });
  let threw = false;
  try { await summary.summarise("clean the kitchen"); } catch { threw = true; }
  assert(threw, `${label} did not fail cleanly, so the Landlord could be shown an empty or broken checklist.`);
}

// A response that does not clearly state whether a task is excluded cannot be
// trusted at all: guessing either invents work or drops a refusal. It must fail
// so the deterministic on-device checklist is kept instead.
{
  const summary = createAnthropicSpeechSummary({
    apiKey: "test-key",
    client: stubClient(jsonReply({ tasks: [{ room: "Kitchen", task: "Clean inside the oven" }] }))
  });
  let threw = false;
  try { await summary.summarise("don't clean inside the oven"); } catch { threw = true; }
  assert(threw, "A task with no exclusion flag was published as an instruction to do the work.");
}

// A refusal the model already phrased negatively must not gain a second
// negation — 'Do not don't clean the oven' reads as permission to clean it.
{
  const summary = createAnthropicSpeechSummary({
    apiKey: "test-key",
    client: stubClient(jsonReply({ tasks: [{ room: "Kitchen", task: "Don't clean inside the oven", excluded: true }] }))
  });
  const [line] = await summary.summarise("don't clean inside the oven");
  assert(!/do not don'?t/i.test(line), `A double negative was published to the Cleaner: ${line}`);
  assert(/don'?t|do not/i.test(line), `The refusal was lost entirely: ${line}`);
}

// One unusable entry must sink the whole response rather than quietly
// publishing a shorter checklist that looks complete.
{
  const summary = createAnthropicSpeechSummary({
    apiKey: "test-key",
    client: stubClient(jsonReply({ tasks: [{ room: "Kitchen", task: "Degrease the worktops", excluded: false }, { room: "Kitchen", task: "", excluded: false }] }))
  });
  let threw = false;
  try { await summary.summarise("degrease the worktops and something else"); } catch { threw = true; }
  assert(threw, "A partial response was published, silently dropping something the customer asked for.");
}

// Duplicate and overflowing output must be bounded the same way the on-device
// parser bounds it.
{
  const many = Array.from({ length: 60 }, (_, index) => ({ room: "Kitchen", task: `Wipe surface ${index}`, excluded: false }));
  const summary = createAnthropicSpeechSummary({ apiKey: "test-key", client: stubClient(jsonReply({ tasks: [...many, ...many] })) });
  const lines = await summary.summarise("wipe everything");
  assert(lines.length === 40 && new Set(lines).size === lines.length, `The summary was not bounded and de-duplicated: ${lines.length} lines.`);
}

assert(await rejects(async () => createAnthropicSpeechSummary({ apiKey: "test-key", client: stubClient(jsonReply({ tasks: [] })) }).summarise("   "), "A spoken walkthrough is required"), "An empty walkthrough was sent to the provider.");

console.log("Speech summary tests passed: optional capability, exclusion safety, walkthrough-only requests, bounded input and output, and clean failure for every provider fault.");
