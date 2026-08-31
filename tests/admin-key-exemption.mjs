/*
 * The legacy `/api/admin/*` local-development exemption, pinned.
 *
 * `isAdminAuthorised` (server.mjs) lets a request through with NO credential
 * when all five of these hold at once:
 *
 *   ADMIN_REQUIRE_KEY is not "true"      (it defaults to off)
 *   the server is bound to loopback
 *   the client connected from loopback
 *   the Host header names a local address
 *   no x-forwarded-for / x-forwarded-host is present
 *
 * That is a deliberate local-development convenience, and production cannot
 * have it: `deployment-readiness.mjs:90` requires ADMIN_REQUIRE_KEY=true and a
 * real ADMIN_KEY, and the server refuses to boot if that preflight fails.
 * `tests/pilot-security-http.mjs` already proves the flag ON denies loopback,
 * and `tests/deployment-readiness.mjs` proves production rejects the flag OFF.
 *
 * What NOTHING covered is the exemption's own conditions — the ones that make
 * it unreachable from anywhere but this machine. Widening any one of them
 * silently converts a local convenience into a remote bypass, and every
 * existing test would stay green. This file boots a server with the flag off,
 * confirms the exemption is genuinely live (otherwise the denials below would
 * prove nothing), and then checks that each condition still denies.
 *
 * Requests are made with `node:http` rather than `fetch` on purpose: `Host` is
 * a forbidden header name, and `fetch` silently DROPS an attempt to set it. A
 * first version of this file used fetch, and its Host cases passed while
 * sending the loopback Host — asserting nothing at all.
 *
 * The audit records this as S-2, assessed as not exploitable in production. The
 * point of this file is that the assessment stays true.
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = await mkdtemp(path.join(tmpdir(), "tideway-admin-exemption-"));
const testDataDir = path.join(testRoot, "OneDrive", "TidewayPrivateData");
const port = 4296;
const origin = `http://127.0.0.1:${port}`;
const localHost = `127.0.0.1:${port}`;
let serverOutput = "";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// ADMIN_REQUIRE_KEY and ADMIN_KEY are deliberately absent: this is exactly the
// unconfigured local posture in which the exemption applies.
const { ADMIN_REQUIRE_KEY, ADMIN_KEY, ...inheritedEnv } = process.env;
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: { ...inheritedEnv, HOST: "127.0.0.1", PORT: String(port), LAN_PORT: "0", DATA_DIR: testDataDir },
  stdio: ["ignore", "pipe", "pipe"]
});
child.stdout.on("data", (chunk) => { serverOutput += chunk; });
child.stderr.on("data", (chunk) => { serverOutput += chunk; });

/** A request that can actually set Host, which fetch cannot. */
function request(headers, requestPath = "/api/admin/records") {
  return new Promise((resolve, reject) => {
    const call = http.request(
      { host: "127.0.0.1", port, path: requestPath, method: "GET", headers: { Host: localHost, Origin: origin, ...headers } },
      (response) => {
        response.resume();
        response.on("end", () => resolve(response.statusCode));
      }
    );
    call.on("error", reject);
    call.end();
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if (await request({}, "/api/health") === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Admin-exemption test server did not start. ${serverOutput}`);
}

try {
  await waitForServer();

  /* ── The exemption is live, so the denials below mean something ──
   *
   * Without this, a server denying everything for an unrelated reason would
   * make every assertion in this file pass while proving nothing. */
  assert(
    await request({}) === 200,
    "The unconfigured local exemption did not apply. Either it has been removed — in which case delete this file, because the conditions it pins no longer exist — or something else denied the request and the checks below prove nothing."
  );

  /* ── Each condition, on its own, must still deny ──
   *
   * A non-local Host is refused earlier, by host validation, so it answers 403
   * rather than 401. Both are denials; the assertion accepts either and rejects
   * anything that gets through. */
  for (const [label, headers] of [
    ["a public Host", { Host: "homle.example" }],
    ["a Host that merely contains a local name", { Host: "localhost.attacker.example" }],
    ["a Host naming a private address", { Host: "10.0.0.5" }],
    ["an x-forwarded-for header", { "x-forwarded-for": "203.0.113.9" }],
    ["an x-forwarded-host header", { "x-forwarded-host": "homle.example" }],
    ["both proxy headers", { "x-forwarded-for": "203.0.113.9", "x-forwarded-host": "homle.example" }],
    // The exemption must not become a way to make any supplied credential pass.
    ["a wrong admin key behind a proxy header", { "x-forwarded-for": "203.0.113.9", "x-admin-key": "not-the-key" }]
  ]) {
    const status = await request(headers);
    assert(
      status === 401 || status === 403,
      `The legacy admin exemption answered ${status} to a request carrying ${label}; it must deny. These conditions are what keep the exemption unreachable from anywhere but this machine — widening one turns a local convenience into a remote bypass, and no other test would notice.`
    );
  }

  console.log("Legacy admin-key exemption tests passed: the unconfigured local exemption applies only on loopback with a local Host and no proxy headers — a public Host, a lookalike Host, a private-address Host, a forwarded-for, a forwarded-host, both together, and a wrong key each deny.");
} finally {
  child.kill("SIGTERM");
  await rm(testRoot, { recursive: true, force: true });
}
