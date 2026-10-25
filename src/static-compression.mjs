// Compression for the files server.mjs serves from public/. Text assets were
// sent uncompressed: a customer document page carried ~300 KB of CSS on every
// visit, on mobile data. Brotli or gzip, chosen from Accept-Encoding, and only
// for types that shrink; images, video and fonts are already compressed.
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const compressible = new Set([".html", ".css", ".js", ".mjs", ".json", ".svg", ".txt", ".xml", ".webmanifest", ".vtt"]);
const minimumBytes = 1024;

/** "br", "gzip" or null, honouring q=0 refusals. Brotli wins when both are allowed. */
export function negotiateEncoding(acceptEncoding) {
  const offered = new Map();
  for (const part of String(acceptEncoding || "").toLowerCase().split(",")) {
    const [name, ...params] = part.trim().split(";");
    if (!name) continue;
    const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
    offered.set(name.trim(), q ? Number(q.slice(2)) : 1);
  }
  const allowed = (name) => (offered.has(name) ? offered.get(name) > 0 : offered.has("*") && offered.get("*") > 0);
  if (allowed("br")) return "br";
  if (allowed("gzip")) return "gzip";
  return null;
}

export function isCompressible(extension, byteLength) {
  return compressible.has(String(extension).toLowerCase()) && byteLength >= minimumBytes;
}

// Files that are the same bytes on every request are compressed once. The key
// includes the modification time, so a deploy or an edit is never served stale.
const cache = new Map();
const maximumCacheEntries = 400;

/** Returns the encoded body, or null when it should be sent as it is. */
export function compressStatic(body, extension, encoding, cacheKey = "") {
  if (!encoding || !isCompressible(extension, body.length)) return null;
  const key = cacheKey ? `${encoding}:${cacheKey}` : "";
  if (key && cache.has(key)) return cache.get(key);
  const encoded = encoding === "br"
    ? brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 9, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } })
    : gzipSync(body, { level: 9 });
  if (encoded.length >= body.length) return null;
  if (key) {
    if (cache.size >= maximumCacheEntries) cache.delete(cache.keys().next().value);
    cache.set(key, encoded);
  }
  return encoded;
}
