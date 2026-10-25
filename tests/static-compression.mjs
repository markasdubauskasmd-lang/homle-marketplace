import assert from "node:assert/strict";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { compressStatic, isCompressible, negotiateEncoding } from "../src/static-compression.mjs";

// Text assets are compressed when the browser accepts it, and never when it
// does not; already-compressed media are left alone.
assert.equal(negotiateEncoding("gzip, deflate, br"), "br");
assert.equal(negotiateEncoding("gzip"), "gzip");
assert.equal(negotiateEncoding("br;q=0, gzip;q=0.5"), "gzip");
assert.equal(negotiateEncoding("br;q=0, gzip;q=0"), null);
assert.equal(negotiateEncoding(""), null);
assert.equal(negotiateEncoding(undefined), null);
assert.equal(negotiateEncoding("identity"), null);
assert.equal(negotiateEncoding("*"), "br");
assert.equal(negotiateEncoding("*;q=0"), null);

const css = Buffer.from(".a{color:red}\n".repeat(400));
assert(isCompressible(".css", css.length) && isCompressible(".HTML", 5000) && isCompressible(".svg", 5000));
for (const media of [".png", ".webp", ".jpg", ".mp4", ".woff2"]) assert(!isCompressible(media, 1e6), `${media} would be compressed twice.`);
assert(!isCompressible(".css", 200), "A tiny file was compressed for no gain.");

const br = compressStatic(css, ".css", "br", "test:1");
assert(br && br.length < css.length / 10);
assert.deepEqual(brotliDecompressSync(br), css, "Brotli did not round-trip.");
assert.strictEqual(compressStatic(css, ".css", "br", "test:1"), br, "An unchanged file was compressed again.");
const gz = compressStatic(css, ".css", "gzip", "test:1");
assert.deepEqual(gunzipSync(gz), css, "Gzip did not round-trip.");
assert.equal(compressStatic(css, ".css", null, "test:1"), null, "A client that refused compression got it.");
assert.equal(compressStatic(Buffer.alloc(5000), ".png", "br"), null);
// A changed file (new modification time) is never served from the old entry.
const changed = Buffer.from(".b{color:blue}\n".repeat(400));
assert.deepEqual(brotliDecompressSync(compressStatic(changed, ".css", "br", "test:2")), changed);
console.log("Static compression passed: Brotli then gzip by Accept-Encoding with q=0 refusals, text types only, round-trips, cached by modification time.");
