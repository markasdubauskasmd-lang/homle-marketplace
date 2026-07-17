import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createFacebookDataDeletionRepository } from "../src/marketplace/facebook-data-deletion-repository.mjs";
import { createFacebookDataDeletionService, verifyFacebookDataDeletionRequest } from "../src/marketplace/facebook-data-deletion.mjs";

const appSecret = "a".repeat(64);
const tokenSecret = "b".repeat(64);
function signed(payload, key = appSecret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${createHmac("sha256", key).update(encoded).digest("base64url")}.${encoded}`;
}

const valid = signed({ algorithm: "HMAC-SHA256", user_id: "123456789", issued_at: 1784246400 });
assert.deepEqual(verifyFacebookDataDeletionRequest(valid, appSecret), { subject: "123456789" });
assert.throws(() => verifyFacebookDataDeletionRequest(signed({ algorithm: "HMAC-SHA1", user_id: "123456789" }), appSecret), /unsupported deletion payload/);
assert.throws(() => verifyFacebookDataDeletionRequest(signed({ algorithm: "HMAC-SHA256", user_id: "not-numeric" }), appSecret), /unsupported deletion payload/);
assert.throws(() => verifyFacebookDataDeletionRequest(valid, "c".repeat(64)), /signature verification failed/);
assert.throws(() => verifyFacebookDataDeletionRequest(`${valid}=`, appSecret), /signature verification failed/);

const repositoryCalls = [];
const repository = {
  async request(input) {
    repositoryCalls.push({ kind: "request", input });
    return { status: "requested", requestedAt: "2026-07-16T12:00:00.000Z", completedAt: null };
  },
  async status(codeHash) {
    repositoryCalls.push({ kind: "status", codeHash });
    return { status: "completed", requestedAt: "2026-07-16T12:00:00.000Z", completedAt: "2026-07-17T12:00:00.000Z" };
  }
};
const service = createFacebookDataDeletionService(repository, { appOrigin: "https://homle.co.uk", appSecret, tokenSecret });
const first = await service.request(valid);
const second = await service.request(valid);
assert.match(first.confirmationCode, /^[A-Za-z0-9_-]{32}$/);
assert.equal(first.confirmationCode, second.confirmationCode, "Meta retry did not receive the same opaque confirmation code for the same app-scoped subject.");
assert.equal(first.statusUrl, `https://homle.co.uk/facebook-data-deletion#code=${first.confirmationCode}`);
assert.equal(repositoryCalls[0].input.subject, "123456789");
assert.equal(repositoryCalls[0].input.subjectHash.length, 32);
assert.equal(repositoryCalls[0].input.confirmationCodeHash.length, 32);
assert.notEqual(repositoryCalls[0].input.subjectHash.toString("hex"), Buffer.from("123456789").toString("hex"), "The repository received a reversible Facebook subject projection.");
const status = await service.status(first.confirmationCode);
assert.equal(status.status, "completed");
assert.equal(await service.status("invalid"), null);

const databaseCalls = [];
const database = {
  async withAuthenticationTransaction(operation) {
    return operation({
      async query(text, values) {
        databaseCalls.push({ text, values });
        return { rows: [{ result: text.includes("request_facebook") ? { status: "requested" } : { status: "completed" } }] };
      }
    });
  }
};
const databaseRepository = createFacebookDataDeletionRepository(database);
await databaseRepository.request(repositoryCalls[0].input);
await databaseRepository.status(Buffer.alloc(32));
assert.match(databaseCalls[0].text, /request_facebook_data_deletion/);
assert.match(databaseCalls[1].text, /get_facebook_data_deletion_status/);
assert.equal(databaseCalls[0].values[1], "123456789");

console.log("Facebook data-deletion tests passed: signed-request verification, opaque idempotent confirmation, narrow status lookup and authentication-only persistence boundary.");
