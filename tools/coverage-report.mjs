// Line-coverage report for the test suite, with no dependencies and no build step.
//
// Node writes raw V8 coverage to the directory named by NODE_V8_COVERAGE. That output
// is byte ranges, not lines, so this maps each uncovered range back onto the lines it
// spans and ignores blank and comment-only lines.
//
//   npm run coverage
//
// Two numbers matter and they are different: the percentage of lines executed in files
// the suite loads, and the list of files it never loads at all. A file that is never
// imported cannot appear in V8's output, so it would silently read as "no data" rather
// than as zero — it is listed separately at the end.
//
// Known blind spot: tests/smoke.mjs exercises server.mjs by spawning it and driving it
// over real HTTP. Coverage for a spawned server that is shut down by signal is not
// captured here, so server.mjs shows as never loaded even though it is heavily tested.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { relative, resolve } from "node:path";

const coverageDir = process.argv[2];
const repoRoot = resolve(process.argv[3] || ".");

// url -> Set of covered byte offsets is far too large; instead track, per file, the
// set of uncovered ranges with count 0, then convert to lines.
const uncoveredByFile = new Map();
const seenFiles = new Set();

for (const name of readdirSync(coverageDir).filter((n) => n.endsWith(".json"))) {
  let payload;
  try { payload = JSON.parse(readFileSync(`${coverageDir}/${name}`, "utf8")); } catch { continue; }
  for (const script of payload.result || []) {
    if (!script.url?.startsWith("file:")) continue;
    let path;
    try { path = fileURLToPath(script.url); } catch { continue; }
    if (!path.startsWith(repoRoot)) continue;
    const rel = relative(repoRoot, path).split("\\").join("/");
    if (rel.startsWith("node_modules/") || rel.startsWith("public/vendor/") || rel.startsWith(".coverage-tmp")) continue;
    seenFiles.add(rel);
    if (!uncoveredByFile.has(rel)) uncoveredByFile.set(rel, []);
    for (const fn of script.functions || []) {
      for (const range of fn.ranges || []) {
        if (range.count === 0) uncoveredByFile.get(rel).push([range.startOffset, range.endOffset]);
      }
    }
  }
}

function lineStats(rel, ranges) {
  const abs = resolve(repoRoot, rel);
  if (!existsSync(abs)) return null;
  const source = readFileSync(abs, "utf8");
  // Offset -> line index.
  const lineStarts = [0];
  for (let i = 0; i < source.length; i += 1) if (source[i] === "\n") lineStarts.push(i + 1);
  const lineOf = (offset) => {
    let low = 0, high = lineStarts.length - 1;
    while (low < high) { const mid = (low + high + 1) >> 1; if (lineStarts[mid] <= offset) low = mid; else high = mid - 1; }
    return low;
  };
  // A line counts as executable if it has code; blanks/comment-only lines are excluded.
  const lines = source.split("\n");
  const executable = new Set();
  lines.forEach((line, index) => {
    const t = line.trim();
    if (!t || t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    executable.add(index);
  });
  const uncovered = new Set();
  for (const [start, end] of ranges) {
    for (let line = lineOf(start); line <= lineOf(Math.max(start, end - 1)); line += 1) {
      if (executable.has(line)) uncovered.add(line);
    }
  }
  const total = executable.size;
  const covered = total - uncovered.size;
  return { total, covered, percent: total ? (covered / total) * 100 : 100 };
}

const groups = { "server.mjs": [], "src/": [], "public/": [], "tools/": [], "root": [] };
function groupOf(rel) {
  if (rel === "server.mjs") return "server.mjs";
  if (rel.startsWith("src/")) return "src/";
  if (rel.startsWith("public/")) return "public/";
  if (rel.startsWith("tools/")) return "tools/";
  if (rel.startsWith("tests/")) return null;
  return "root";
}

const rows = [];
for (const [rel, ranges] of uncoveredByFile) {
  const g = groupOf(rel);
  if (!g) continue;
  const stats = lineStats(rel, ranges);
  if (!stats) continue;
  rows.push({ rel, group: g, ...stats });
  groups[g].push(stats);
}

console.log("=== EXERCISED BY THE SUITE (per-area line coverage) ===");
let allTotal = 0, allCovered = 0;
for (const [name, list] of Object.entries(groups)) {
  if (!list.length) continue;
  const total = list.reduce((s, r) => s + r.total, 0);
  const covered = list.reduce((s, r) => s + r.covered, 0);
  allTotal += total; allCovered += covered;
  console.log(`${name.padEnd(12)} ${String(list.length).padStart(3)} files  ${String(covered).padStart(6)}/${String(total).padEnd(6)} lines  ${((covered / total) * 100).toFixed(1)}%`);
}
console.log(`${"TOTAL".padEnd(12)}      ${"".padStart(4)}  ${allCovered}/${allTotal} lines  ${((allCovered / allTotal) * 100).toFixed(1)}%`);

console.log("\n=== 20 LOWEST-COVERAGE FILES THE SUITE DOES LOAD ===");
for (const r of rows.filter((r) => r.total >= 40).sort((a, b) => a.percent - b.percent).slice(0, 20)) {
  console.log(`  ${r.percent.toFixed(1).padStart(5)}%  ${String(r.covered).padStart(4)}/${String(r.total).padEnd(4)}  ${r.rel}`);
}

console.log("\n=== NEVER LOADED BY ANY TEST (0% — invisible to coverage) ===");
const candidates = [];
function walk(dir) {
  for (const entry of readdirSync(resolve(repoRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`.replace(/^\.\//, "");
    if (entry.name === "node_modules" || entry.name === "vendor" || entry.name.startsWith(".")) continue;
    if (entry.isDirectory()) walk(rel);
    else if (/\.(mjs|js)$/.test(entry.name) && !rel.startsWith("tests/")) candidates.push(rel);
  }
}
walk("src"); walk("public"); walk("tools");
for (const f of ["server.mjs"]) candidates.push(f);
const never = candidates.filter((c) => !seenFiles.has(c)).sort();
console.log(`  ${never.length} of ${candidates.length} source files are never imported by any test:`);
for (const f of never) console.log(`    ${f}`);
