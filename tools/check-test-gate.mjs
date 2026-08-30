/*
 * Fails when a file in tests/ is not reached by `pnpm test`.
 *
 * Thirteen test files had drifted outside the gate — ten of them named by no
 * script at all. A test nothing runs is worse than a test nobody wrote: it
 * reads as coverage on the file listing and provides none, and the regressions
 * it would have caught land anyway. Two did land that way.
 *
 * The gate is `pretest`, `test` and `posttest`, each of which chains further
 * scripts by name, so this follows those chains rather than scanning for
 * literals in one string.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scripts = JSON.parse(await readFile(path.join(repositoryRoot, "package.json"), "utf8")).scripts || {};

// Files that are libraries for other tests rather than suites of their own, or
// that npm lifecycle already runs under a different name. Empty today; every
// addition needs a reason written beside it.
const notSuites = new Set([]);

function reached(name, seen = new Set()) {
  if (seen.has(name) || !Object.hasOwn(scripts, name)) return new Set();
  seen.add(name);
  const body = scripts[name];
  const files = new Set([...body.matchAll(/tests\/([A-Za-z0-9_.-]+\.mjs)/g)].map((match) => match[1]));
  for (const [, referenced] of body.matchAll(/(?:pnpm|npm)\s+run\s+([A-Za-z0-9:_-]+)/g)) {
    for (const file of reached(referenced, seen)) files.add(file);
  }
  return files;
}

const gated = new Set([...reached("pretest"), ...reached("test"), ...reached("posttest")]);
const present = (await readdir(path.join(repositoryRoot, "tests"))).filter((name) => name.endsWith(".mjs"));
const missing = present.filter((name) => !gated.has(name) && !notSuites.has(name)).sort();
const stale = [...gated].filter((name) => !present.includes(name)).sort();

if (missing.length || stale.length) {
  if (missing.length) {
    console.error(`${missing.length} test file(s) are not run by \`pnpm test\`. Add them to a script the gate reaches, or record why they are not suites in tools/check-test-gate.mjs:`);
    for (const name of missing) console.error(`  tests/${name}`);
  }
  if (stale.length) {
    console.error(`${stale.length} test file(s) are named by the gate but do not exist. A renamed or deleted suite leaves the gate failing loudly rather than silently skipping:`);
    for (const name of stale) console.error(`  tests/${name}`);
  }
  process.exit(1);
}

console.log(`Test gate coverage passed: all ${present.length} files in tests/ are reached by \`pnpm test\`, and every file the gate names exists.`);
