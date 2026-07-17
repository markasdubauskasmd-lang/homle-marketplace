# Trusted client identity

## Security boundary

Tideway's shared abuse controls need one server-derived client key. `src/marketplace/trusted-client-key.mjs` owns that boundary; deployment adapters cannot override it.

With `TRUST_PROXY=false`, the resolver uses only the actual TCP peer address from `request.socket.remoteAddress`. Any browser-supplied `X-Forwarded-For` value is ignored.

With `TRUST_PROXY=true` and a blank `TRUST_PROXY_PROVIDER`, startup also requires `TRUSTED_PROXY_CIDRS`. The resolver then:

1. verifies that the actual TCP peer belongs to one explicitly configured IPv4 or IPv6 address/CIDR;
2. requires exactly one `X-Forwarded-For` value containing a bare valid IP address;
3. rejects missing, repeated, comma-chained, port-bearing or malformed values; and
4. fails closed if the peer is not trusted.

The reverse proxy must remove every client-supplied forwarding header and write exactly one `X-Forwarded-For` address. Do not enable proxy trust merely because the application is publicly hosted. Prefer a private network or firewall rule that prevents clients from reaching the application port without passing through the configured proxy.

Render is an explicit separate provider mode because its public service port is reachable only through Render's load balancer and its documented client identity is the first address in `X-Forwarded-For`. `TRUST_PROXY_PROVIDER=render` is accepted only with `NODE_ENV=production`, `RENDER=true`, a platform-shaped `RENDER_SERVICE_ID`, the platform `*.onrender.com` hostname and no generic proxy CIDRs. It validates every address in a bounded one-to-16-entry chain before using the first. These platform variables must come from Render; do not define them manually. A different provider cannot select this mode.

The resolver returns a bounded internal key. The PostgreSQL limiter purpose-HMACs it separately for every scope before database access; the raw address is not stored in the limiter table or returned to the browser. A resolver failure becomes the existing generic `503` abuse-control response and sends only the private cause to approved monitoring.

## Configuration

Direct application listener:

```dotenv
TRUST_PROXY=false
TRUST_PROXY_PROVIDER=
TRUSTED_PROXY_CIDRS=
```

Single trusted reverse-proxy hop:

```dotenv
TRUST_PROXY=true
TRUST_PROXY_PROVIDER=
TRUSTED_PROXY_CIDRS=10.20.0.0/16,2001:db8:10::/48
```

Render web service:

```dotenv
TRUST_PROXY=true
TRUST_PROXY_PROVIDER=render
TRUSTED_PROXY_CIDRS=
```

The example CIDRs are documentation-only and must not be copied into production. Record the actual immediate proxy networks from the selected hosting provider's current authoritative documentation. If the platform cannot guarantee a single sanitized header or a bounded immediate-peer network, this resolver intentionally prevents marketplace enablement until a deployment-specific authenticated proxy boundary is designed and tested.

## Required staging evidence

- A direct request with a spoofed forwarding header is grouped by its socket address.
- A request from every configured proxy network receives the sanitized client key.
- A request reaching the application port outside those networks is rejected.
- Missing and malformed forwarding values are rejected without reaching authentication or Cleaner search; generic proxies also reject multiple values, while Render accepts only a fully valid bounded chain.
- IPv4, IPv4-mapped IPv6 and native IPv6 paths behave consistently.
- Two application instances reach the same PostgreSQL rate-limit threshold for the same sanitized client address.
- Application and proxy logs are reviewed so raw addresses are retained only where documented and necessary under the privacy policy.

Changing the hop topology, proxy provider or authoritative network ranges requires another review and staging test before deployment.
