// Runs the test suite with V8 coverage collection, then prints the report.
// Separate from `npm test` so the normal test run stays fast and side-effect free.
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const coverageDir = resolve(root, ".coverage-tmp");

rmSync(coverageDir, { recursive: true, force: true });

// `npm test` is reused verbatim so coverage always reflects the real suite.
const suite = spawnSync("npm", ["test"], { cwd: root, stdio: ["ignore", "ignore", "inherit"], shell: true, env: { ...process.env, NODE_V8_COVERAGE: coverageDir } });

const report = spawnSync(process.execPath, [resolve(root, "tools/coverage-report.mjs"), coverageDir, root], { cwd: root, stdio: "inherit" });

rmSync(coverageDir, { recursive: true, force: true });

if (suite.status !== 0) {
  console.error("\nThe suite did not pass, so the numbers above cover only the tests that ran.");
  process.exit(suite.status ?? 1);
}
process.exit(report.status ?? 0);
