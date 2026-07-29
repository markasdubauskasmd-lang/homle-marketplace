import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { benchmarkCaseErrors, runScanBenchmark } from "../src/marketplace/scan-benchmark.mjs";
import { defaultPricingRuleset, normalizedPricingRuleset } from "../src/marketplace/scan-pricing.mjs";

// Runs the scan benchmark and prints the result.
//
// Deliberately loud about what it was measured on. The most damaging thing this
// tool could do is print a precision figure that somebody quotes in a meeting
// without noticing it came from hand-written fixtures.

const toolPath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(toolPath), "..");
const defaultDataset = path.join(projectRoot, "data", "scan-benchmark", "synthetic-seed.json");

export async function loadBenchmarkCases(datasetPath) {
  const contents = await readFile(datasetPath, "utf8");
  let parsed;
  try { parsed = JSON.parse(contents); } catch { throw new Error(`${datasetPath} is not valid JSON.`); }
  const cases = Array.isArray(parsed) ? parsed : parsed?.cases;
  if (!Array.isArray(cases) || !cases.length) throw new Error(`${datasetPath} contains no benchmark cases.`);
  const errors = cases.flatMap((entry) => benchmarkCaseErrors(entry));
  if (errors.length) throw new Error(`The benchmark dataset is not usable:\n  ${errors.join("\n  ")}`);
  return cases;
}

function percent(value) {
  return value === null ? "not measured" : `${(value * 100).toFixed(1)}%`;
}

export function formatBenchmarkReport(report) {
  const lines = [];
  lines.push(`Scan benchmark v${report.benchmarkVersion} · complexity model v${report.complexityModelVersion} · ruleset ${report.rulesetId}`);
  lines.push(`${report.caseCount} cases (${report.realCases} real, ${report.syntheticCases} synthetic)`);
  if (report.datasetIsSynthetic) {
    lines.push("");
    lines.push("*** SYNTHETIC DATASET — these figures measure the harness, NOT accuracy on real homes. ***");
    lines.push("*** No number below may be quoted as a precision, recall, agreement or price-error result. ***");
  }
  lines.push("");
  lines.push(`Coverage: device ${report.coverage.deviceClasses.join("/")} · lighting ${report.coverage.lighting.join("/")} · levels ${report.coverage.levelsSeen.join(",")}`);
  lines.push("");
  for (const [name, value] of Object.entries(report.metrics)) {
    const comparison = report.comparisons.find((entry) => entry.metric === name);
    const target = comparison ? ` (target ${percent(comparison.target)}, ${comparison.met ? "met" : "MISSED"})` : "";
    // Kappa and Brier are not percentages, so they are printed as scores.
    const shown = ["conditionAgreementKappa", "calibrationBrier"].includes(name)
      ? (value === null ? "not measured" : value.toFixed(4))
      : percent(value);
    lines.push(`  ${name.padEnd(26)} ${shown}${target}`);
  }
  lines.push("");
  const missed = report.comparisons.filter((entry) => !entry.met);
  if (missed.length) lines.push(`${missed.length} target${missed.length === 1 ? "" : "s"} missed: ${missed.map((entry) => entry.metric).join(", ")}`);
  else if (report.comparisons.length) lines.push(`Every measured target met (${report.comparisons.length}).`);
  else lines.push("No target could be measured from this dataset.");
  lines.push(report.acceptable
    ? "ACCEPTABLE: measured on real consented cases and every target met."
    : report.datasetIsSynthetic
      ? "NOT ACCEPTABLE as evidence: the dataset contains synthetic cases."
      : "NOT ACCEPTABLE: at least one measured target was missed.");
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === toolPath) {
  try {
    const datasetPath = path.resolve(process.argv[2] || defaultDataset);
    const cases = await loadBenchmarkCases(datasetPath);
    const rulesetPath = process.argv[3];
    const ruleset = rulesetPath
      ? normalizedPricingRuleset(JSON.parse(await readFile(path.resolve(rulesetPath), "utf8")))
      : defaultPricingRuleset;
    console.log(formatBenchmarkReport(runScanBenchmark(cases, { ruleset })));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
