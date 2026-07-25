// Syntax-checks every shipped source and test file.
//
// This replaces a hand-maintained `&&` chain of ~190 `node --check` calls. That chain
// had three problems: files were added to the repo without being added to it (29 source
// files and 15 test files were never checked at all), the first failure aborted the run
// so you fixed one syntax error per attempt, and it eventually exceeded the Windows
// command-line limit and simply stopped working.
//
// Deriving the list from disk means it cannot drift, reports every failure at once, and
// stays one short command.
import { readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Everything that ships or is executed. `public/vendor/` is excluded: it is third-party
// minified code, pinned by checksum and never edited here.
const targets = [
  { dir: "public", pattern: /\.js$/, recurse: false },
  { dir: "src", pattern: /\.mjs$/, recurse: true },
  { dir: "tools", pattern: /\.mjs$/, recurse: false },
  { dir: "tests", pattern: /\.mjs$/, recurse: false },
  { dir: "scripts", pattern: /\.mjs$/, recurse: false },
  { dir: ".", pattern: /\.mjs$/, recurse: false }
];

function collect({ dir, pattern, recurse }, out = []) {
  for (const entry of readdirSync(resolve(root, dir), { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "vendor" || entry.name.startsWith(".")) continue;
    const relative = dir === "." ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (recurse) collect({ dir: relative, pattern, recurse }, out);
    } else if (pattern.test(entry.name)) out.push(relative);
  }
  return out;
}

const files = [...new Set(targets.flatMap((target) => collect(target)))].sort();

// `node --check` takes one file at a time, so they run concurrently with a cap rather
// than 200-odd sequential process spawns.
const concurrency = 12;
const failures = [];
let next = 0;

async function worker() {
  while (next < files.length) {
    const file = files[next];
    next += 1;
    const problem = await new Promise((done) => {
      const child = spawn(process.execPath, ["--check", file], { cwd: root, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", (code) => done(code === 0 ? null : stderr.trim().split("\n").slice(0, 4).join("\n")));
      child.on("error", (error) => done(String(error.message)));
    });
    if (problem) failures.push({ file, problem });
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));

if (failures.length) {
  for (const { file, problem } of failures.sort((a, b) => a.file.localeCompare(b.file))) {
    console.error(`\n${file}\n${problem}`);
  }
  console.error(`\nSyntax check failed for ${failures.length} of ${files.length} files.`);
  process.exit(1);
}

console.log(`Syntax check passed for ${files.length} shipped source and test files.`);
