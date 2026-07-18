import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createTrustedClientAddressResolver, createTrustedClientKeyResolver } from "../src/marketplace/trusted-client-key.mjs";

function request(remoteAddress, forwardedFor, trueClientIp) {
  const headers = {};
  if (forwardedFor !== undefined) headers["x-forwarded-for"] = forwardedFor;
  if (trueClientIp !== undefined) headers["true-client-ip"] = trueClientIp;
  return { socket: { remoteAddress }, headers };
}

const direct = createTrustedClientKeyResolver({ TRUST_PROXY: "false" });
const directAddress = createTrustedClientAddressResolver({ TRUST_PROXY: "false" });
assert.equal(direct(request("198.51.100.20")), "direct:ipv4:198.51.100.20");
assert.equal(directAddress(request("198.51.100.20", "203.0.113.77")), "198.51.100.20");
assert.equal(direct(request("::ffff:192.0.2.9", "203.0.113.77")), "direct:ipv4:192.0.2.9", "Direct mode trusted a browser-supplied forwarding header.");
assert.equal(direct(request("2001:db8::8")), "direct:ipv6:2001:db8::8");
assert.throws(() => direct(request("not-an-ip")), /peer address/);
assert.throws(() => direct({ headers: {} }), /peer address/);

const proxied = createTrustedClientKeyResolver({
  TRUST_PROXY: "true",
  TRUSTED_PROXY_CIDRS: "10.20.0.0/16, 2001:db8:10::/48, 127.0.0.1"
});
assert.equal(proxied(request("10.20.3.4", "198.51.100.42")), "proxy:ipv4:198.51.100.42");
assert.equal(proxied(request("2001:db8:10::15", "2001:db8:20::9")), "proxy:ipv6:2001:db8:20::9");
assert.equal(proxied(request("::ffff:127.0.0.1", "192.0.2.44")), "proxy:ipv4:192.0.2.44");
assert.throws(() => proxied(request("10.21.3.4", "198.51.100.42")), /configured trusted proxy/);
assert.throws(() => proxied(request("10.20.3.4")), /exactly one/);
assert.throws(() => proxied(request("10.20.3.4", "198.51.100.42, 10.20.3.4")), /exactly one/);
assert.throws(() => proxied(request("10.20.3.4", ["198.51.100.42"])), /exactly one/);
assert.throws(() => proxied(request("10.20.3.4", "198.51.100.42:443")), /Forwarded client address/);

const rendered = createTrustedClientKeyResolver({
  NODE_ENV: "production",
  TRUST_PROXY: "true",
  TRUST_PROXY_PROVIDER: "render",
  TRUSTED_PROXY_CIDRS: "",
  RENDER: "true",
  RENDER_SERVICE_ID: "srv-abcdef123456",
  RENDER_EXTERNAL_HOSTNAME: "homle-marketplace.onrender.com"
});
assert.equal(rendered(request("10.0.0.8", "198.51.100.71", "198.51.100.71")), "render:ipv4:198.51.100.71");
assert.equal(rendered(request("10.0.0.8", "2001:db8::71, 172.16.0.4, 10.0.0.8", "2001:db8::71")), "render:ipv6:2001:db8::71");
assert.equal(
  rendered(request("10.0.0.8", "203.0.113.99, 198.51.100.71, 172.71.195.1, 10.0.0.8", "198.51.100.71")),
  "render:ipv4:198.51.100.71",
  "A browser-forged leftmost X-Forwarded-For entry displaced the Cloudflare-verified client identity."
);
assert.equal(rendered(request("10.0.0.8", "198.51.100.71, 10.0.0.8", "::ffff:198.51.100.71")), "render:ipv4:198.51.100.71");
assert.throws(() => rendered(request("10.0.0.8", "198.51.100.71")), /True-Client-IP/, "Render mode identified a client without the Cloudflare-verified header.");
assert.throws(() => rendered(request("10.0.0.8", "203.0.113.99, 10.0.0.8", "198.51.100.71")), /must appear in its X-Forwarded-For chain/, "A True-Client-IP outside the validated chain was accepted.");
assert.throws(() => rendered(request("10.0.0.8", "198.51.100.71, 10.0.0.8", "not-an-ip")), /True-Client-IP/);
assert.throws(() => rendered(request("10.0.0.8")), /Render must provide/);
assert.throws(() => rendered(request("10.0.0.8", "198.51.100.71,,10.0.0.8", "198.51.100.71")), /between one and 16/);
assert.throws(() => rendered(request("10.0.0.8", `${"198.51.100.1,".repeat(16)}198.51.100.2`, "198.51.100.1")), /between one and 16/);
assert.throws(() => rendered(request("10.0.0.8", "198.51.100.71,not-an-ip", "198.51.100.71")), /Forwarded client address/);

assert.throws(() => createTrustedClientKeyResolver({ TRUST_PROXY: "yes" }), /true or false/);
assert.throws(() => createTrustedClientKeyResolver({ TRUST_PROXY: "false", TRUST_PROXY_PROVIDER: "render" }), /requires TRUST_PROXY/);
assert.throws(() => createTrustedClientKeyResolver({ TRUST_PROXY: "true", TRUST_PROXY_PROVIDER: "invented" }), /blank or render/);
for (const invalid of [
  {},
  { NODE_ENV: "development", RENDER: "true", RENDER_SERVICE_ID: "srv-abcdef123456", RENDER_EXTERNAL_HOSTNAME: "homle.onrender.com" },
  { NODE_ENV: "production", RENDER: "true", RENDER_EXTERNAL_HOSTNAME: "homle.onrender.com" },
  { NODE_ENV: "production", RENDER: "true", RENDER_SERVICE_ID: "srv-abcdef123456", RENDER_EXTERNAL_HOSTNAME: "homle.example.com" },
  { NODE_ENV: "production", RENDER: "true", RENDER_SERVICE_ID: "srv-abcdef123456", RENDER_EXTERNAL_HOSTNAME: "homle.onrender.com", TRUSTED_PROXY_CIDRS: "10.0.0.0/8" }
]) assert.throws(() => createTrustedClientKeyResolver({ TRUST_PROXY: "true", TRUST_PROXY_PROVIDER: "render", ...invalid }), /Render|TRUSTED_PROXY_CIDRS/);
assert.throws(() => createTrustedClientKeyResolver({ TRUST_PROXY: "true" }), /TRUSTED_PROXY_CIDRS is required/);
assert.throws(() => createTrustedClientKeyResolver({ TRUST_PROXY: "true", TRUSTED_PROXY_CIDRS: "10.0.0.0/33" }), /prefix length/);
assert.throws(() => createTrustedClientKeyResolver({ TRUST_PROXY: "true", TRUSTED_PROXY_CIDRS: "10.0.0.0/eight" }), /prefix length/);
assert.throws(() => createTrustedClientKeyResolver({ TRUST_PROXY: "true", TRUSTED_PROXY_CIDRS: "10.0.0.1,,10.0.0.2" }), /between one and 64/);

const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
assert(serverSource.includes("createTrustedClientAddressResolver") && serverSource.includes("resolveClientAddress(request)") && !serverSource.includes('String(request.headers["x-forwarded-for"] || "").split'), "The pilot server bypassed the reviewed trusted-client resolver.");

console.log("Trusted client-key tests passed: direct-header isolation, explicit CIDR proxy trust, Render production binding, bounded forwarding chains and fail-closed configuration.");
