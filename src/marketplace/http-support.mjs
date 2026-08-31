import { AccountHttpError } from "./account-security.mjs";

export const maximumBodyBytes = 64 * 1024;
export const maximumWebhookBodyBytes = 1024 * 1024;
// One captured room photograph, base64-encoded inside a JSON body. Bounded well
// below the webhook allowance and used only by the room-reading route.
export const maximumRoomPhotoBodyBytes = 900 * 1024;
// The structured scan carries no image data — 20 rooms, 200 objects, and a
// bounded note and evidence string each. It exceeds the 64 KB default only
// because a full property with long room notes can, and it stays far below the
// photo allowance because nothing here is ever a picture.
export const maximumRoomScanBodyBytes = 256 * 1024;

export function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers
  });
  response.end(JSON.stringify(body));
}

function contentType(request) {
  const supplied = request?.headers?.["content-type"];
  return Array.isArray(supplied) ? supplied[0] : String(supplied || "");
}

export async function readJsonObject(request, limitBytes = maximumBodyBytes) {
  if (!/^application\/json(?:\s*;|$)/i.test(contentType(request))) throw Object.assign(new SyntaxError("Send a JSON request body."), { code: "json-content-type-required" });
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.length;
    if (byteLength > limitBytes) throw Object.assign(new Error("The request body is too large."), { statusCode: 413, code: "request-too-large" });
    chunks.push(buffer);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new SyntaxError("The JSON request body is invalid."), { code: "invalid-json" }); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw Object.assign(new SyntaxError("The JSON request body must be an object."), { code: "json-object-required" });
  return value;
}

export async function readRawBody(request, maximumBytes = maximumWebhookBodyBytes) {
  const declaredLength = Number(request?.headers?.["content-length"]);
  if (Number.isFinite(declaredLength) && (declaredLength < 0 || declaredLength > maximumBytes)) throw Object.assign(new Error("The request body is too large."), { statusCode: 413, code: "request-too-large" });
  const chunks = [];
  let byteLength = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.length;
    if (byteLength > maximumBytes) throw Object.assign(new Error("The request body is too large."), { statusCode: 413, code: "request-too-large" });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, byteLength);
}

export function errorResponse(error) {
  if (error instanceof AccountHttpError) return { statusCode: error.statusCode, code: error.code, message: error.message };
  if (error instanceof SyntaxError) return { statusCode: 400, code: error.code || "invalid-request", message: error.message };
  if (error instanceof TypeError || error instanceof RangeError) return { statusCode: 422, code: "validation-failed", message: error.message };
  if ([400, 403, 404, 409, 413, 422, 429, 503].includes(error?.statusCode)) return { statusCode: error.statusCode, code: error.code || ({ 400: "invalid-request", 403: "forbidden", 404: "not-found", 409: "conflict", 413: "request-too-large", 422: "validation-failed", 429: "rate-limited", 503: "temporarily-unavailable" }[error.statusCode]), message: error.message };
  // A unique-constraint violation is the caller asking for something that
  // already exists. It is a conflict, not a fault, and answering 500 made three
  // ordinary situations look like a broken server:
  //
  //   * Retrying a create with the same client-supplied id — which is the
  //     journey's own recovery path, and which the browser already handles as a
  //     409 by re-reading its list.
  //   * A double-click or a retry-after-timeout on a support request, where the
  //     idempotency key exists precisely so the second one is safe. Six
  //     concurrent calls with one key produced four 201s and two 500s.
  //   * Probing another tenant's id, where 500-versus-201 told the caller
  //     whether that id exists anywhere in the system.
  //
  // One message for every case, so the answer carries no more than the status.
  // PostgreSQL 23505 is unique_violation.
  if (error?.code === "23505") return { statusCode: 409, code: "already-exists", message: "That record already exists. Reload before trying again." };
  return { statusCode: 500, code: "internal-error", message: "Something went wrong. Please try again." };
}

export function methodNotAllowed(response, methods) {
  sendJson(response, 405, { ok: false, code: "method-not-allowed", error: "This method is not allowed." }, { Allow: methods.join(", ") });
}
