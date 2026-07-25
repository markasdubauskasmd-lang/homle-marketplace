import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Every test file must actually be run, and every source file must actually be
// syntax-checked. Both lists in package.json are hand-maintained chains hundreds of
// commands long, so a file added without being wired in is invisible: it looks tested
// because it exists and it looks checked because `npm run check` passes.
//
// This was not hypothetical. `tests/spoken-scope.mjs` covers the price-sensitive scope
// exclusions and was never executed by `npm test`, which is how a one-character
// clause-boundary bug survived: refusals like "do not clean inside the oven" were
// reported to an Administrator as requested, priced work. Its own test would have caught
// it on day one.
//
// Derived rather than restated, so it cannot drift: the script graph is expanded here,
// including pre/post hooks, and compared against what is on disk.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).scripts;

// npm and pnpm both run `preX`/`postX` around `X`, so an entry point pulls in its hooks.
function expand(name, seen = new Set()) {
  if (seen.has(name) || !scripts[name]) return "";
  seen.add(name);
  const parts = [];
  for (const hook of [`pre${name}`, name, `post${name}`]) {
    if (!scripts[hook] || (hook !== name && seen.has(hook))) continue;
    if (hook !== name) seen.add(hook);
    const body = scripts[hook];
    parts.push(body);
    // Follow `npm run other` / `pnpm run other` references.
    for (const [, referenced] of body.matchAll(/(?:npm|pnpm)\s+run\s+([\w:-]+)/g)) parts.push(expand(referenced, seen));
  }
  return parts.join(" && ");
}

// `check` and `test` are the two commands CI runs; everything must be reachable from one.
const graph = `${expand("check")} && ${expand("test")}`;

// Deliberately excludes `node --check tests/x.mjs`: parsing a file is not running it.
// An earlier version of this regex allowed any flag, so a syntax check counted as an
// execution and four suites looked covered while never actually running.
const executedTests = new Set([...graph.matchAll(/node\s+tests\/([\w.-]+\.mjs)/g)].map((m) => m[1]));
const syntaxChecked = new Set([...graph.matchAll(/node\s+--check\s+([\w./-]+)/g)].map((m) => m[1]));

function sourceFiles(dir, pattern, out = []) {
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "vendor" || entry.name.startsWith(".")) continue;
    const relative = dir === "." ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(relative, pattern, out);
    else if (pattern.test(entry.name)) out.push(relative);
  }
  return out;
}

/* ── Every test file is executed ── */

const testFiles = readdirSync(resolve(root, "tests")).filter((name) => name.endsWith(".mjs"));
// A test file may legitimately run by being imported into another test rather than
// invoked directly; that still executes its assertions. But only if the *importer* runs.
// Walking the import graph outward from the directly executed suites is what makes that
// distinction — accepting "imported by anything" would let a whole cluster of suites
// vouch for each other while none of them is ever executed.
const importsOf = new Map();
for (const name of testFiles) {
  const source = readFileSync(resolve(root, "tests", name), "utf8");
  // Both `import x from "./y.mjs"` and the bare side-effect form `import "./y.mjs"`,
  // which is how several suites pull in a sibling's assertions.
  importsOf.set(name, [...source.matchAll(/import\s+(?:[\s\S]*?\sfrom\s+)?["']\.\/([\w.-]+\.mjs)["']/g)].map((match) => match[1]));
}

const reached = new Set(executedTests);
const pending = [...executedTests];
while (pending.length) {
  for (const imported of importsOf.get(pending.pop()) || []) {
    if (reached.has(imported)) continue;
    reached.add(imported);
    pending.push(imported);
  }
}

const unrunTests = testFiles.filter((name) => !reached.has(name));
assert.deepEqual(unrunTests, [], `These test files exist but are never executed by \`npm run check\` or \`npm test\`, so their assertions protect nothing:\n  ${unrunTests.join("\n  ")}`);

/* ── The lifecycle hooks CI depends on actually run ── */

// `check` and `test` are the two commands CI invokes, and 144 of this repo's ~200
// verification commands live in their `pre`/`post` hooks. Running those hooks is pnpm's
// documented default, so this is a pin against a future default change, not a repair —
// an earlier version of this comment claimed a live skip that was never observed.
//
// Read as the last-wins value rather than "appears somewhere", because a later
// `enable-pre-post-scripts=false` would silently take precedence over an earlier `true`.
const npmrc = existsSync(resolve(root, ".npmrc")) ? readFileSync(resolve(root, ".npmrc"), "utf8") : "";
const prePostSettings = [...npmrc.matchAll(/^\s*enable-pre-post-scripts\s*=\s*(\S+)\s*$/gm)].map((match) => match[1]);
assert.ok(prePostSettings.length > 0, "`.npmrc` no longer pins enable-pre-post-scripts. 144 of this repo's ~200 verification commands run only via pre/post hook expansion, so that behaviour should be stated rather than inherited from a default.");
assert.equal(prePostSettings.at(-1), "true", `\`.npmrc\` sets enable-pre-post-scripts=${prePostSettings.at(-1)}. The last assignment wins, and anything but true drops most of this repo's verification while \`check\` and \`test\` still report success.`);
for (const hook of ["precheck", "postcheck", "pretest", "posttest"]) {
  assert.ok(scripts[hook], `The \`${hook}\` script has gone, so whatever it verified is no longer checked.`);
}

/* ── Syntax checking stays derived from disk, not hand-listed ── */

// It used to be a chain of 199 `node --check` calls. Files were added to the repo
// without being added to the chain (29 source and 15 test files were unchecked), the
// first failure aborted the rest, and it eventually grew past the Windows
// command-line limit and stopped running at all. `tools/syntax-check.mjs` globs the
// tree instead, so it cannot fall behind. This assertion stops anyone quietly going
// back to a hand-maintained list.
assert.ok(graph.includes("tools/syntax-check.mjs"), "`npm run check` no longer runs the derived syntax checker, so newly added files may never be syntax-checked.");
// The `check` entry point itself must stay derived. Focused `check:*` sub-scripts may
// still name specific modules — that is a deliberate narrower gate, not the whole-tree
// guarantee — but `check` going back to a hand list is how the 44 unchecked files
// happened, and how the chain grew past the Windows command-line limit.
assert.ok(!/node --check/.test(scripts.check), `The \`check\` script has gone back to hand-listed \`node --check\` calls. Files added later would silently escape checking — let tools/syntax-check.mjs derive the list from disk instead.\n  check = ${scripts.check.slice(0, 200)}`);

const covered = [
  ...sourceFiles("public", /\.js$/).filter((path) => !path.startsWith("public/vendor/")),
  ...sourceFiles("src", /\.mjs$/),
  ...sourceFiles("tools", /\.mjs$/),
  ...readdirSync(root).filter((name) => name.endsWith(".mjs")),
  ...testFiles.map((name) => `tests/${name}`)
];

console.log(`Verification-coverage tests passed: all ${testFiles.length} test files are executed, and syntax checking is derived from disk so all ${covered.length} source and test files are covered without a hand-maintained list.`);
