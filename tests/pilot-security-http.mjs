import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = await mkdtemp(path.join(tmpdir(), "tideway-security-http-"));
const testDataDir = path.join(testRoot, "OneDrive", "TidewayPrivateData");
const port = 4293;
const base = `http://127.0.0.1:${port}`;
const adminKey = "test-security-admin-key";
let serverOutput = "";
const child = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  env: { ...process.env, HOST: "127.0.0.1", PORT: String(port), LAN_PORT: "0", DATA_DIR: testDataDir, ADMIN_KEY: adminKey, ADMIN_REQUIRE_KEY: "true" },
  stdio: ["ignore", "pipe", "pipe"]
});
child.stdout.on("data", (chunk) => { serverOutput += chunk; });
child.stderr.on("data", (chunk) => { serverOutput += chunk; });

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Security-test server did not start. ${serverOutput}`);
}

async function sameOriginFetch(pathname, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("origin", base);
  return fetch(`${base}${pathname}`, { ...init, headers });
}

const roomScan = (requestId) => ({
  requestId,
  email: "security-test@example.com",
  transcript: "In the kitchen wipe every worktop.",
  checklist: ["Kitchen: Wipe every worktop"],
  photos: [{ area: "Kitchen", note: "Worktops need wiping", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zs7sAAAAASUVORK5CYII=" }],
  scopeCompleteConfirmed: true,
  consent: true
});

try {
  await waitForServer();
  assert(serverOutput.includes("Homle privacy warning") && serverOutput.includes("OneDrive") && serverOutput.includes("DATA_DIR"), "A cloud-synchronised private data path did not produce the required startup warning.");

  const missingOrigin = await fetch(`${base}/api/cleaning-requests`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert(missingOrigin.status === 403 && (await missingOrigin.json()).error.includes("same-origin"), "A mutation without Origin was not rejected before validation.");

  const crossOrigin = await fetch(`${base}/api/cleaning-requests`, { method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.example" }, body: "{}" });
  assert(crossOrigin.status === 403, "A cross-origin mutation was not rejected.");

  const sameOriginInvalid = await sameOriginFetch("/api/cleaning-requests", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert(sameOriginInvalid.status === 422, "A same-origin mutation did not reach normal input validation.");

  const sensitiveAccessRequest = await sameOriginFetch("/api/cleaning-requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ contactName: "Access Safety Test", email: "access-safety@invalid.example", phone: "07123456789", postcode: "SW1A 1AA", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "2 bedrooms", accessNotes: "Meet the site manager", hazards: "None known", frequency: "One-off", preferredDate: "2099-01-01", preferredTimeWindow: "Flexible", details: "Please clean the oven. Door code is 4821", consent: true })
  });
  const sensitiveAccessBody = await sensitiveAccessRequest.json();
  assert(sensitiveAccessRequest.status === 422 && sensitiveAccessBody.errors?.some((error) => error.includes("only after a booking is accepted")), "An early request accepted a door code outside the dedicated access field or returned an unhelpful lifecycle error.");
  assert(await readFile(path.join(testDataDir, "cleaning-requests.ndjson"), "utf8").catch(() => "") === "", "A rejected access-code request wrote private lead data.");

  const cleaningRequest = await sameOriginFetch("/api/cleaning-requests", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    body: JSON.stringify({ contactName: "Security Test Customer", email: "security-test@example.com", phone: "07123456789", postcode: "SW1A 1AA", customerType: "Landlord", propertyType: "Flat or house", service: "Rental turnover clean", siteSize: "2 bedrooms and 1 bathroom", accessNotes: "Test-only key collection instructions", hazards: "None known", frequency: "One-off", preferredDate: "2099-01-01", preferredTimeWindow: "Flexible", consent: true })
  });
  const cleaningRequestBody = await cleaningRequest.json();
  assert(cleaningRequest.status === 201 && /^[A-Za-z0-9_-]{32}$/.test(cleaningRequestBody.customerStatusToken), "The security fixture could not create its private request.");

  const emailOnlyScan = await sameOriginFetch("/api/job-briefs", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, body: JSON.stringify(roomScan(cleaningRequestBody.reference)) });
  const emailOnlyScanBody = await emailOnlyScan.json();
  assert(emailOnlyScan.status === 422 && emailOnlyScanBody.errors?.some((error) => error.includes("private request tracker")), "A matching email still authorised a room scan without its private tracker token.");
  assert(!("customerStatusToken" in emailOnlyScanBody), "The rejected email-only scan disclosed a private tracker token.");
  const briefsBeforeAuthorisedScan = await readFile(path.join(testDataDir, "job-briefs.ndjson"), "utf8").catch(() => "");
  assert(briefsBeforeAuthorisedScan === "", "The rejected email-only scan wrote a job brief.");

  const authorisedScan = await sameOriginFetch("/api/job-briefs", {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "x-request-token": cleaningRequestBody.customerStatusToken },
    body: JSON.stringify(roomScan(cleaningRequestBody.reference))
  });
  const authorisedScanBody = await authorisedScan.json();
  assert(authorisedScan.status === 201 && authorisedScanBody.reference.startsWith("BRF-"), "A token-authorised room scan was not stored.");
  assert(!("customerStatusToken" in authorisedScanBody), "A successful room scan re-disclosed its private tracker token.");

  for (const pathname of ["/admin", "/admin.html"]) {
    const deniedShell = await fetch(`${base}${pathname}`);
    assert(deniedShell.status === 401, `${pathname} bypassed ADMIN_REQUIRE_KEY on loopback.`);
    const authorisedShell = await fetch(`${base}${pathname}`, { headers: { "x-admin-key": adminKey } });
    assert(authorisedShell.ok, `${pathname} rejected the configured admin key.`);
  }

  const missingAdminOrigin = await fetch(`${base}/api/admin/records`, { headers: { "x-admin-key": adminKey } });
  assert(missingAdminOrigin.status === 403, "An admin API read without same-origin browser metadata was accepted.");
  const crossOriginAdmin = await fetch(`${base}/api/admin/records`, { headers: { origin: "https://attacker.example", "x-admin-key": adminKey } });
  assert(crossOriginAdmin.status === 403, "A cross-origin admin API read was accepted.");
  const missingAdminKey = await sameOriginFetch("/api/admin/records");
  assert(missingAdminKey.status === 401, "ADMIN_REQUIRE_KEY did not protect a same-origin loopback API read.");
  const authorisedAdmin = await sameOriginFetch("/api/admin/records", { headers: { "x-admin-key": adminKey } });
  assert(authorisedAdmin.ok, "A same-origin admin API read with the configured key was rejected.");
  const unsafeStorageConfig = await sameOriginFetch("/api/admin/config", { headers: { "x-admin-key": adminKey } });
  const unsafeStorageConfigBody = await unsafeStorageConfig.json();
  const storageProjection = JSON.stringify(unsafeStorageConfigBody.storageSafety);
  assert(unsafeStorageConfig.ok && unsafeStorageConfigBody.storageSafety?.safeForPrivatePilot === false && unsafeStorageConfigBody.storageSafety?.cloudSyncProvider === "OneDrive" && unsafeStorageConfigBody.storageSafety?.explicitlyConfigured === true && unsafeStorageConfigBody.storageSafety?.relocationRequired === true && unsafeStorageConfigBody.storageSafety?.automaticRelocation === false, "The admin API did not expose the synthetic OneDrive risk without moving data.");
  assert(!storageProjection.includes(testDataDir) && !Object.hasOwn(unsafeStorageConfigBody.storageSafety, "path"), "The storage-safety projection exposed the private local data path.");
  assert(unsafeStorageConfigBody.readiness.missing?.operatingRules?.includes("private data folder outside cloud-sync services"), "Unsafe private storage did not block launch readiness.");

  console.log("Pilot HTTP security tests passed.");
} finally {
  if (child.exitCode === null) {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
  }
  await rm(testRoot, { recursive: true, force: true });
}
