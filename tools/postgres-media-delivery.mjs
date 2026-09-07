import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Client, Pool } from "pg";
import { createMarketplaceDatabase } from "../src/marketplace/database.mjs";
import { createRequestMediaRepository } from "../src/marketplace/request-media-repository.mjs";
import { createMediaRepository } from "../src/marketplace/media-repository.mjs";
import { createRequestMediaService } from "../src/marketplace/request-media-service.mjs";
import { createMediaService } from "../src/marketplace/media-service.mjs";
import { createMarketplaceHttpRouter } from "../src/marketplace/marketplace-http.mjs";

assert.equal(process.env.TIDEWAY_DATABASE_TEST_CONFIRMATION, "RUN TIDEWAY DISPOSABLE DATABASE TESTS");
const ownerUrl = new URL(process.env.DATABASE_INTEGRATION_OWNER_URL);
const appUrl = new URL(process.env.DATABASE_INTEGRATION_APP_URL);
assert(/_tideway_test$/.test(ownerUrl.pathname));
assert.equal(ownerUrl.pathname, appUrl.pathname);
assert.equal(ownerUrl.host, appUrl.host);
assert.notEqual(ownerUrl.username, appUrl.username);
const owner = new Client({ connectionString: ownerUrl.toString() });
const pool = new Pool({ connectionString: appUrl.toString(), max: 2 });
const requestId = "30000000-0000-4000-8000-000000000001";
const requestPhotoId = "60000000-0000-4000-8000-000000000001";
const bookingId = "40000000-0000-4000-8000-000000000001";
const jobPhotoId = "61000000-0000-4000-8000-000000000001";
const landlord = { userId: "10000000-0000-4000-8000-000000000001", roles: ["landlord"] };
const cleaner = { userId: "10000000-0000-4000-8000-000000000002", roles: ["cleaner"] };
const outsider = { userId: "10000000-0000-4000-8000-000000000003", roles: ["landlord"] };
const bytes = await readFile(new URL("../public/landing/dark-kitchen.jpg", import.meta.url));
const checksum = createHash("sha256").update(bytes).digest("hex");
const sqlFile = async name => (await readFile(new URL("../db/integration/" + name, import.meta.url), "utf8")).replace(/^\\set ON_ERROR_STOP on\r?\n/, "");
let created = false;
try {
  await owner.connect();
  const target = (await owner.query("SELECT current_database() AS name")).rows[0];
  assert(target.name.endsWith("_tideway_test"));
  assert.equal((await owner.query("SELECT count(*)::int AS count FROM users WHERE id=$1", [landlord.userId])).rows[0].count, 0, "Disposable fixture already exists; refusing to overwrite it");
  await owner.query(await sqlFile("marketplace-integration-setup.sql"));
  created = true;
  const role = (await pool.query("SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert.equal(role.name, decodeURIComponent(appUrl.username));
  assert.equal(role.rolsuper, false);
  assert.equal(role.rolbypassrls, false);
  await owner.query("UPDATE cleaning_request_photos SET byte_size=$1,checksum_sha256=decode($2,'hex') WHERE id=$3", [bytes.length, checksum, requestPhotoId]);
  await owner.query("INSERT INTO job_photos(id,booking_id,uploaded_by,photo_type,storage_key,mime_type,byte_size,checksum_sha256,width_pixels,height_pixels,sanitized_at,note) VALUES($1,$2,$3,'before',$4,'image/jpeg',$5,decode($6,'hex'),2000,1334,now(),'Synthetic integration photo')", [jobPhotoId, bookingId, cleaner.userId, "job-photos/" + bookingId + "/" + jobPhotoId + ".jpg", bytes.length, checksum]);

  const database = createMarketplaceDatabase(pool);
  let reads = 0, duringRead = null, time = Date.now();
  const storage = { async readPrivateImage() {
    reads++;
    if (duringRead) { const action = duringRead; duringRead = null; await action(); }
    return bytes;
  } };
  const serviceOptions = { objectStorage: storage, appOrigin: "http://127.0.0.1:4173", now: () => new Date(time) };
  const requestMedia = createRequestMediaService(createRequestMediaRepository(database), serviceOptions);
  const jobMedia = createMediaService(createMediaRepository(database), serviceOptions);
  const unused = new Proxy({}, { get: () => async () => { throw new Error("Unexpected unrelated service call"); } });
  // Authentication is a fixture seam. All authorization below it is the real
  // runtime-role database, repository and media service, followed by the real router.
  const dependencies = new Proxy({
    security: { async protect(request) {
      if (!request.actor) throw Object.assign(new Error("Sign in required"), { statusCode: 401 });
      return { actor: request.actor };
    } },
    requestMediaService: requestMedia, mediaService: jobMedia,
    rateLimiter: { async consume() { return { allowed: true }; } }
  }, { get: (target, key) => key in target ? target[key] : unused });
  const router = createMarketplaceHttpRouter(dependencies, { clientKey: () => "media-integration" });
  async function read(url, actor) {
    const response = { statusCode: 0, headers: {}, body: null,
      writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
      end(body) { this.body = body; }
    };
    assert(await router.handle({ method: "GET", url, actor, headers: {} }, response, new URL(url)));
    return response;
  }
  function delivered(response) {
    assert.equal(response.statusCode, 200);
    assert(Buffer.isBuffer(response.body));
    assert.deepEqual(response.body, bytes);
    assert.match(response.headers["Cache-Control"], /private.*no-store/);
    assert.equal(response.headers["Cross-Origin-Resource-Policy"], "same-origin");
  }
  function denied(response, status = 404) {
    assert.equal(response.statusCode, status);
    assert(!Buffer.isBuffer(response.body), "Denied response released image bytes");
  }
  const requestAccess = await requestMedia.getPhotoAccess(cleaner, requestId, requestPhotoId);
  delivered(await read(requestAccess.url, cleaner));
  delivered(await read(requestAccess.url, landlord));
  const beforeDenial = reads;
  denied(await read(requestAccess.url, outsider));
  denied(await read(requestAccess.url, null), 401);
  assert.equal(reads, beforeDenial, "Unauthorized reads reached storage");

  // Revoke the actual pre-acceptance preview permission after issuing a URL.
  await owner.query("UPDATE cleaning_requests SET cleaner_preview_authorized=false WHERE id=$1", [requestId]);
  denied(await read(requestAccess.url, cleaner));
  assert.equal(reads, beforeDenial);
  delivered(await read(requestAccess.url, landlord));
  await owner.query("UPDATE cleaning_requests SET cleaner_preview_authorized=true WHERE id=$1", [requestId]);
  duringRead = () => owner.query("UPDATE cleaning_requests SET cleaner_preview_authorized=false WHERE id=$1", [requestId]);
  const beforeRace = reads;
  denied(await read(requestAccess.url, cleaner));
  assert.equal(reads, beforeRace + 1, "The in-flight revocation case never fetched the fixture");

  const jobAccess = await jobMedia.getPhotoAccess(landlord, bookingId, jobPhotoId);
  delivered(await read(jobAccess.url, landlord));
  delivered(await read(jobAccess.url, cleaner));
  const beforeJobDenial = reads;
  denied(await read(jobAccess.url, outsider));
  assert.equal(reads, beforeJobDenial);
  duringRead = () => owner.query("DELETE FROM job_photos WHERE id=$1", [jobPhotoId]);
  denied(await read(jobAccess.url, landlord));
  denied(await read(jobAccess.url, landlord));
  time += 5 * 60 * 1000;
  denied(await read(requestAccess.url, landlord), 410);
  console.log("Real database photo delivery passed: runtime role, owner/participant bytes, cross-customer denial, preview withdrawal before/during read, deleted job-photo denial, expiry and private HTTP headers.");
} finally {
  try {
    await owner.query("ROLLBACK");
    if (created) await owner.query(await sqlFile("marketplace-integration-cleanup.sql"));
  } finally {
    await Promise.allSettled([pool.end(), owner.end()]);
  }
}
