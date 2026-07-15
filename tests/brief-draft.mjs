import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { briefDraftKey, briefDraftLifetimeMs, clearBriefDraft, readBriefDraft, saveBriefDraft } from "../public/brief-draft.js";

const root = fileURLToPath(new URL("..", import.meta.url));

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

const storage = memoryStorage();
const now = Date.UTC(2026, 6, 15, 18, 0, 0);
assert.equal(briefDraftKey("req-1234abcd"), "tidewayBriefDraftV1:REQ-1234ABCD");
assert.equal(briefDraftKey("bad-reference"), "");

const saved = saveBriefDraft(storage, {
  reference: "req-1234abcd",
  transcript: "Kitchen worktops and bathroom shower.",
  tasks: ["- Kitchen: wipe worktops", "Kitchen: wipe worktops", "• Bathroom: clean shower"]
}, now);
assert.equal(saved.reference, "REQ-1234ABCD");
assert.deepEqual(saved.tasks, ["Kitchen: wipe worktops", "Bathroom: clean shower"]);
assert.deepEqual(readBriefDraft(storage, "REQ-1234ABCD", now + 10_000)?.tasks, saved.tasks);
assert.equal(readBriefDraft(storage, "REQ-OTHER123", now + 10_000), null, "A draft must not cross request references.");

const storedText = storage.values.get(briefDraftKey("REQ-1234ABCD"));
assert(!storedText.includes("data:image") && !storedText.includes("customer@example.com"), "Draft storage must contain text scope only.");
assert.equal(readBriefDraft(storage, "REQ-1234ABCD", now + briefDraftLifetimeMs), null, "Expired drafts must be deleted.");
assert.equal(storage.values.size, 0);

saveBriefDraft(storage, { reference: "REQ-1234ABCD", transcript: "Temporary", tasks: [] }, now);
clearBriefDraft(storage, "REQ-1234ABCD");
assert.equal(storage.values.size, 0, "Explicit deletion must clear the request draft.");

saveBriefDraft(storage, { reference: "REQ-1234ABCD", transcript: "", tasks: [] }, now);
assert.equal(storage.values.size, 0, "Empty scans must not create drafts.");

storage.setItem(briefDraftKey("REQ-1234ABCD"), "not-json");
assert.equal(readBriefDraft(storage, "REQ-1234ABCD", now), null);
assert.equal(storage.values.size, 0, "Corrupt drafts must be removed.");

const [briefHtml, briefJs] = await Promise.all([
  readFile(path.join(root, "public", "brief.html"), "utf8"),
  readFile(path.join(root, "public", "brief.js"), "utf8")
]);
assert(briefHtml.includes("Photos and videos are never stored in the recovery draft"));
assert(briefJs.includes("restoreCurrentDraft();") && briefJs.includes("clearBriefDraft(window.sessionStorage, currentRequestReference())"));
assert(briefJs.includes("window.addEventListener(\"offline\"") && briefJs.includes("window.addEventListener(\"beforeunload\""));
assert(briefJs.includes("draftReferenceMismatch()"), "Text recovery must stay bound to one request reference.");

console.log("brief draft tests passed");
