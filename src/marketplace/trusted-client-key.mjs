import { BlockList, isIP } from "node:net";

// WHATWG URL canonicalises an IPv6 literal (compresses zero-runs, lowercases),
// so two spellings of the same address compare equal and produce one stable
// limiter identity. IPv4 (including dotted IPv4-mapped, unwrapped in
// normalizedAddress) needs no change.
function canonicalIpv6(address) {
  try {
    return new URL(`http://[${address}]`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return address;
  }
}

function normalizedAddress(value, label) {
  const address = typeof value === "string" ? value.trim() : "";
  if (!address || address.length > 64 || /[\u0000-\u0020\u007f]/.test(address)) throw new TypeError(`${label} is not a valid IP address.`);
  const mapped = address.toLowerCase().startsWith("::ffff:") ? address.slice(7) : address;
  const family = isIP(mapped);
  if (!family) throw new TypeError(`${label} is not a valid IP address.`);
  return { address: family === 6 ? canonicalIpv6(mapped) : mapped, family };
}

function proxyTrustList(value) {
  const source = typeof value === "string" ? value.trim() : "";
  if (!source || source.length > 4096) throw new TypeError("TRUSTED_PROXY_CIDRS is required and must be bounded when TRUST_PROXY=true.");
  const entries = source.split(",").map((entry) => entry.trim());
  if (!entries.length || entries.length > 64 || entries.some((entry) => !entry)) throw new TypeError("TRUSTED_PROXY_CIDRS must contain between one and 64 IP addresses or CIDRs.");

  const blockList = new BlockList();
  for (const entry of entries) {
    const slash = entry.lastIndexOf("/");
    if (slash === -1) {
      const parsed = normalizedAddress(entry, "Trusted proxy address");
      blockList.addAddress(parsed.address, parsed.family === 4 ? "ipv4" : "ipv6");
      continue;
    }
    if (entry.indexOf("/") !== slash) throw new TypeError("TRUSTED_PROXY_CIDRS contains an invalid CIDR.");
    const parsed = normalizedAddress(entry.slice(0, slash), "Trusted proxy network");
    const prefixText = entry.slice(slash + 1);
    if (!/^\d{1,3}$/.test(prefixText)) throw new TypeError("TRUSTED_PROXY_CIDRS contains an invalid prefix length.");
    const prefix = Number(prefixText);
    const maximum = parsed.family === 4 ? 32 : 128;
    if (prefix < 0 || prefix > maximum) throw new TypeError("TRUSTED_PROXY_CIDRS contains an invalid prefix length.");
    blockList.addSubnet(parsed.address, prefix, parsed.family === 4 ? "ipv4" : "ipv6");
  }
  return blockList;
}

function trustProxyEnabled(value) {
  const selected = String(value || "false").trim().toLowerCase();
  if (selected === "false") return false;
  if (selected === "true") return true;
  throw new TypeError("TRUST_PROXY must be true or false.");
}

function trustedProxyProvider(value) {
  const selected = String(value || "").trim().toLowerCase();
  if (!selected) return null;
  if (selected === "render") return selected;
  throw new TypeError("TRUST_PROXY_PROVIDER must be blank or render.");
}

function validateRenderProxyEnvironment(env) {
  if (env.NODE_ENV !== "production" || String(env.RENDER || "").trim().toLowerCase() !== "true") {
    throw new TypeError("Render proxy trust is available only in a production Render service.");
  }
  if (!/^srv-[a-z0-9]{6,64}$/.test(String(env.RENDER_SERVICE_ID || "").trim().toLowerCase())) {
    throw new TypeError("Render proxy trust requires the platform-provided RENDER_SERVICE_ID.");
  }
  const hostname = String(env.RENDER_EXTERNAL_HOSTNAME || "").trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.onrender\.com$/.test(hostname)) {
    throw new TypeError("Render proxy trust requires the platform-provided onrender.com hostname.");
  }
  if (String(env.TRUSTED_PROXY_CIDRS || "").trim()) {
    throw new TypeError("TRUSTED_PROXY_CIDRS must be blank when TRUST_PROXY_PROVIDER=render.");
  }
}

function remoteClient(request) {
  return normalizedAddress(request?.socket?.remoteAddress, "Request peer address");
}

function forwardedEntries(request, { chainAllowed = false } = {}) {
  const header = request?.headers?.["x-forwarded-for"];
  if (typeof header !== "string" || !header || header.length > 1024) throw new TypeError(chainAllowed ? "Render must provide a bounded X-Forwarded-For chain." : "The trusted proxy must provide exactly one X-Forwarded-For address.");
  const entries = header.split(",").map((entry) => entry.trim());
  if (!chainAllowed && entries.length !== 1) throw new TypeError("The trusted proxy must provide exactly one X-Forwarded-For address.");
  if (chainAllowed && (entries.length < 1 || entries.length > 16 || entries.some((entry) => !entry))) throw new TypeError("Render must provide between one and 16 X-Forwarded-For addresses.");
  return entries.map((entry) => normalizedAddress(entry, "Forwarded client address"));
}

function forwardedClient(request) {
  return forwardedEntries(request)[0];
}

// Render appends to any browser-supplied X-Forwarded-For instead of clearing it,
// so the leftmost chain entry is attacker-controlled and must never identify the
// client. Render fronts every service with Cloudflare, which sets True-Client-IP
// to the verified connecting address; require that header and cross-check it
// against the validated bounded chain, failing closed on any mismatch.
//
// THE UNVERIFIED ASSUMPTION, STATED. Everything here rests on Cloudflare
// REPLACING an inbound True-Client-IP rather than passing it through. That is
// its documented behaviour, and it is why the chain cross-check is meaningful:
// a caller who sends `True-Client-IP: X` and `X-Forwarded-For: X` satisfies the
// cross-check on its own, so if the header ever reached the application
// unreplaced, the caller would be choosing their own rate-limit identity and
// every IP-keyed limit — sign-in throttling included — would be evadable.
//
// It has NOT been measured against the deployed platform. What that measurement
// is, precisely: from outside, send both headers with an address you do not own
// and read them back from a request-echo route. If the value you sent survives,
// this is exploitable and the fix is to stop trusting headers and pin the peer
// instead. See S-6 in HOMLE_MASTER_AUDIT.md.
//
// What IS done here without that measurement: Cloudflare sets CF-Connecting-IP
// on every request and, unlike True-Client-IP, it is not an optional feature.
// When it is present the two must agree, so forging only one of them no longer
// works. It is deliberately NOT required: making an unconfirmed header
// mandatory would answer 503 on every throttled route if the platform does not
// send it, and breaking sign-in is worse than the risk being closed.
function renderForwardedClient(request) {
  const chain = forwardedEntries(request, { chainAllowed: true });
  const trueClient = normalizedAddress(request?.headers?.["true-client-ip"], "Render True-Client-IP");
  if (!chain.some((entry) => entry.address === trueClient.address && entry.family === trueClient.family)) {
    throw new TypeError("Render True-Client-IP must appear in its X-Forwarded-For chain.");
  }
  const connecting = request?.headers?.["cf-connecting-ip"];
  if (connecting) {
    const cloudflareClient = normalizedAddress(connecting, "Cloudflare CF-Connecting-IP");
    if (cloudflareClient.address !== trueClient.address || cloudflareClient.family !== trueClient.family) {
      throw new TypeError("Cloudflare CF-Connecting-IP and True-Client-IP must identify the same client.");
    }
  }
  return trueClient;
}

export function createTrustedClientAddressResolver(env = process.env) {
  const proxyEnabled = trustProxyEnabled(env.TRUST_PROXY);
  const provider = trustedProxyProvider(env.TRUST_PROXY_PROVIDER);
  if (!proxyEnabled && provider) throw new TypeError("TRUST_PROXY_PROVIDER requires TRUST_PROXY=true.");
  if (provider === "render") validateRenderProxyEnvironment(env);
  const trustedProxies = proxyEnabled && !provider ? proxyTrustList(env.TRUSTED_PROXY_CIDRS) : null;

  return function trustedClientAddress(request) {
    const peer = remoteClient(request);
    if (!proxyEnabled) return peer.address;
    if (provider === "render") return renderForwardedClient(request).address;
    const type = peer.family === 4 ? "ipv4" : "ipv6";
    if (!trustedProxies.check(peer.address, type)) throw new TypeError("The request did not arrive from a configured trusted proxy.");
    return forwardedClient(request).address;
  };
}

export function createTrustedClientKeyResolver(env = process.env) {
  const proxyEnabled = trustProxyEnabled(env.TRUST_PROXY);
  const provider = trustedProxyProvider(env.TRUST_PROXY_PROVIDER);
  const resolveAddress = createTrustedClientAddressResolver(env);
  return function trustedClientKey(request) {
    const client = normalizedAddress(resolveAddress(request), "Resolved client address");
    return `${proxyEnabled ? provider || "proxy" : "direct"}:ipv${client.family}:${client.address}`;
  };
}
