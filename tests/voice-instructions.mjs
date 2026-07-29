import { createAnthropicSpeechSummary, instructionKinds } from "../src/marketplace/speech-summary.mjs";

function assert(condition, message) { if (!condition) throw new Error(message); }
async function rejects(run, fragment) {
  try { await run(); } catch (error) { return String(error?.message || "").includes(fragment); }
  return false;
}

const stub = (reply, capture = {}) => ({
  messages: {
    async create(request) { Object.assign(capture, { request, calls: (capture.calls || 0) + 1 }); return typeof reply === "function" ? reply(request) : reply; }
  }
});
const jsonReply = (payload) => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(payload) }] });
const summaryFor = (payload, capture) => createAnthropicSpeechSummary({ apiKey: "test-key", client: stub(jsonReply(payload), capture) });

assert(instructionKinds.length === 4, "The instruction taxonomy is not four kinds.");

/* ── A restriction is not a task ───────────────────────────────────────── */

// The failure this exists to end: "do not move the paperwork" reaching a
// cleaner as another line on a to-do list, indistinguishable from work.
{
  const summary = summaryFor({ tasks: [
    { room: "Study", task: "Move the paperwork on the desk", excluded: true, kind: "restriction", subject: "the paperwork on the desk", priority: "high" },
    { room: "Kitchen", task: "Degrease the worktops", excluded: false, kind: "request", subject: "the worktops", priority: "normal" },
    { room: "Hallway", task: "Mind the loose bottom stair", excluded: false, kind: "safety", subject: "the bottom stair", priority: "high" },
    { room: "Living room", task: "Stack the cushions on the left", excluded: false, kind: "preference", subject: "the cushions", priority: "normal" }
  ] });
  const instructions = await summary.classify("...");
  assert(instructions.length === 4, "A spoken instruction was dropped during classification.");
  const byKind = Object.fromEntries(instructions.map((entry) => [entry.kind, entry]));
  assert(byKind.restriction && byKind.request && byKind.safety && byKind.preference, "The four instruction kinds were not preserved.");
  assert(byKind.restriction.roomName === "Study" && byKind.restriction.subject === "the paperwork on the desk",
    "A restriction lost the room or the thing it protects.");
  assert(byKind.safety.priority === "high", "A stressed safety warning lost its priority.");
  assert(byKind.request.excluded === false && byKind.restriction.excluded === true, "The refusal flag was lost.");
}

/* ── The cautious fallback ─────────────────────────────────────────────── */

// A response already in flight during a deployment carries no `kind`. Reading
// it must fall the safe way: a refusal becomes a restriction, never a request.
{
  const summary = summaryFor({ tasks: [
    { room: "Kitchen", task: "Clean inside the oven", excluded: true },
    { room: "Kitchen", task: "Mop the floor", excluded: false }
  ] });
  const [refusal, work] = await summary.classify("...");
  assert(refusal.kind === "restriction", "A refusal with no stated kind was not treated as a restriction.");
  assert(work.kind === "request", "Ordinary work with no stated kind was not treated as a request.");
}

// A refusal the model labelled as work to do is the one combination that cannot
// be honoured, whatever it called it.
{
  const summary = summaryFor({ tasks: [{ room: "Study", task: "Move the paperwork", excluded: true, kind: "request" }] });
  const [entry] = await summary.classify("...");
  assert(entry.kind === "restriction", "A refusal labelled as a request was carried through as work to do.");
}

// An unrecognised kind resolves rather than being trusted.
{
  const summary = summaryFor({ tasks: [{ room: "Kitchen", task: "Mop the floor", excluded: false, kind: "urgent-thing" }] });
  const [entry] = await summary.classify("...");
  assert(entry.kind === "request", "An unrecognised instruction kind was accepted.");
}

// A fabricated "high" would push a cleaner's attention onto something the
// customer never stressed.
{
  const summary = summaryFor({ tasks: [{ room: "Kitchen", task: "Mop the floor", excluded: false, kind: "request", priority: "critical" }] });
  const [entry] = await summary.classify("...");
  assert(entry.priority === "normal", "An unrecognised priority was not treated as normal.");
}

/* ── Both views come from one reading ──────────────────────────────────── */

// Two provider calls could disagree about what was said, and the checklist and
// the restrictions must not be able to contradict each other.
{
  const capture = {};
  const summary = summaryFor({ tasks: [
    { room: "Kitchen", task: "Degrease the worktops", excluded: false, kind: "request" },
    { room: "Study", task: "Move the paperwork", excluded: true, kind: "restriction" }
  ] }, capture);
  const detailed = await summary.summariseDetailed("...");
  assert(capture.calls === 1, `Producing both views made ${capture.calls} provider calls rather than one.`);
  assert(detailed.instructions.length === 2, "The structured view lost an instruction.");
  // `tasks` stays byte-identical to summarise(), refusal lines included.
  // Filtering restrictions out before anything renders them separately would
  // silently drop a customer instruction, which is worse than showing it in the
  // wrong place.
  assert(detailed.tasks.length === 2, "The checklist dropped a line when the structured view was added.");
  assert(detailed.tasks.some((line) => line === "Study: Do not move the paperwork"),
    `A refusal stopped appearing in the checklist: ${JSON.stringify(detailed.tasks)}`);
}

// The structured view degrading must never cost the Landlord their checklist.
{
  const summary = createAnthropicSpeechSummary({
    apiKey: "test-key",
    client: stub(jsonReply({ tasks: [{ room: "Kitchen", task: "Degrease the worktops", excluded: false, kind: "request" }] }))
  });
  const detailed = await summary.summariseDetailed("...");
  assert(detailed.tasks.length === 1 && detailed.instructions.length === 1, "A usable reading did not produce both views.");
}

/* ── The strictness the flat path already had is not relaxed ───────────── */

// A response that cannot say whether something was refused cannot be trusted at
// all: guessing either way invents work or drops a refusal.
{
  const summary = summaryFor({ tasks: [{ room: "Kitchen", task: "Clean the oven", kind: "request" }] });
  assert(await rejects(() => summary.classify("..."), "did not state whether a task was excluded"),
    "An entry with no refusal flag was classified anyway.");
}
{
  const summary = summaryFor({ tasks: [{ room: "Kitchen", task: "x", excluded: false, kind: "request" }] });
  assert(await rejects(() => summary.classify("..."), "unusable task"), "An unusable instruction was classified.");
}
{
  const summary = summaryFor({ tasks: [] });
  assert(await rejects(() => summary.classify("say something"), "no usable tasks"), "An empty classification was returned as success.");
}

// Duplicates are collapsed per room, not across rooms: the same instruction in
// two rooms is two instructions.
{
  const summary = summaryFor({ tasks: [
    { room: "Kitchen", task: "Mop the floor", excluded: false, kind: "request" },
    { room: "Kitchen", task: "Mop the floor", excluded: false, kind: "request" },
    { room: "Bathroom", task: "Mop the floor", excluded: false, kind: "request" }
  ] });
  const instructions = await summary.classify("...");
  assert(instructions.length === 2, `Room-scoped duplicates were not handled: ${instructions.length}`);
  assert(instructions[0].roomName === "Kitchen" && instructions[1].roomName === "Bathroom", "Collapsing duplicates lost a room.");
}

console.log("Structured voice-instruction checks passed.");
