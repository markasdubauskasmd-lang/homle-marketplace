import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(projectRoot, "tools", "relocate-data.ps1");
const tempBase = path.resolve(os.tmpdir());
const fixtureRoot = path.join(tempBase, `tideway-relocation-test-${randomUUID()}`);
const source = path.join(fixtureRoot, "source");
const destination = path.join(fixtureRoot, "private-destination");

function powershell(args) {
  return spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true
  });
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertSafeFixturePath(candidate) {
  const resolved = path.resolve(candidate);
  assert.ok(resolved.startsWith(`${tempBase}${path.sep}`), "fixture must remain inside the system temp directory");
  assert.ok(path.basename(resolved).startsWith("tideway-relocation-test-"), "fixture must use the expected disposable prefix");
}

try {
  await mkdir(path.join(source, "job-brief-images", "BRF-TEST"), { recursive: true });
  const records = Buffer.from('{"id":"synthetic-only"}\n', "utf8");
  const image = Buffer.from([0, 1, 2, 3, 254, 255]);
  await writeFile(path.join(source, "cleaning-requests.ndjson"), records);
  await writeFile(path.join(source, "job-brief-images", "BRF-TEST", "room.jpg"), image);

  const dryRun = powershell(["-DataDirectory", source, "-DestinationDirectory", destination]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /DRY RUN ONLY/);
  await assert.rejects(stat(destination), { code: "ENOENT" }, "dry-run must not create the destination");

  const unconfirmed = powershell([
    "-DataDirectory", source,
    "-DestinationDirectory", destination,
    "-ExecuteCopy",
    "-ServerStoppedConfirmed",
    "-Confirmation", "wrong phrase"
  ]);
  assert.notEqual(unconfirmed.status, 0, "an incorrect confirmation phrase must fail");
  await assert.rejects(stat(destination), { code: "ENOENT" }, "a refused run must not create the destination");

  const cloudDestination = path.join(fixtureRoot, "OneDrive", "TidewayData");
  const cloudRefusal = powershell(["-DataDirectory", source, "-DestinationDirectory", cloudDestination]);
  assert.notEqual(cloudRefusal.status, 0, "a cloud-synchronised destination must fail even in rehearsal mode");
  await assert.rejects(stat(cloudDestination), { code: "ENOENT" }, "a refused cloud destination must not be created");

  const copied = powershell([
    "-DataDirectory", source,
    "-DestinationDirectory", destination,
    "-ExecuteCopy",
    "-ServerStoppedConfirmed",
    "-Confirmation", "COPY TIDEWAY PRIVATE DATA"
  ]);
  assert.equal(copied.status, 0, copied.stderr);
  assert.match(copied.stdout, /COPY VERIFIED: 2 private files/);

  const copiedRecords = await readFile(path.join(destination, "cleaning-requests.ndjson"));
  const copiedImage = await readFile(path.join(destination, "job-brief-images", "BRF-TEST", "room.jpg"));
  assert.equal(hash(copiedRecords), hash(records));
  assert.equal(hash(copiedImage), hash(image));
  assert.equal(hash(await readFile(path.join(source, "cleaning-requests.ndjson"))), hash(records), "source records must remain unchanged");
  assert.equal(hash(await readFile(path.join(source, "job-brief-images", "BRF-TEST", "room.jpg"))), hash(image), "source media must remain unchanged");

  const overwriteRefusal = powershell([
    "-DataDirectory", source,
    "-DestinationDirectory", destination,
    "-ExecuteCopy",
    "-ServerStoppedConfirmed",
    "-Confirmation", "COPY TIDEWAY PRIVATE DATA"
  ]);
  assert.notEqual(overwriteRefusal.status, 0, "an existing non-empty destination must never be merged or overwritten");

  console.log("data relocation safeguards passed");
} finally {
  assertSafeFixturePath(fixtureRoot);
  await rm(fixtureRoot, { recursive: true, force: true });
}
