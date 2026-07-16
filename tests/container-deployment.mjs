import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [dockerfile, dockerignore, server, manifestText] = await Promise.all([
  readFile(new URL("../Dockerfile", import.meta.url), "utf8"),
  readFile(new URL("../.dockerignore", import.meta.url), "utf8"),
  readFile(new URL("../server.mjs", import.meta.url), "utf8"),
  readFile(new URL("../package.json", import.meta.url), "utf8")
]);
const manifest = JSON.parse(manifestText);

assert.equal((dockerfile.match(/^FROM node:24\.17\.0-bookworm-slim(?: AS \w+)?$/gm) || []).length, 2, "Container stages must use the exact reviewed Node runtime tag.");
assert(dockerfile.includes("corepack prepare pnpm@11.7.0 --activate"), "Container install does not use the manifest-pinned pnpm release.");
assert(dockerfile.indexOf("node tools/check-dependency-lock.mjs") < dockerfile.indexOf("pnpm install"), "Container installs dependencies before verifying the reviewed lock graph.");
assert(dockerfile.includes("pnpm install --frozen-lockfile --prod --ignore-scripts"), "Container install is not frozen, production-only and lifecycle-script-free.");
assert(!/^\s*(?:ADD|COPY)\s+\.\s+/m.test(dockerfile) && !dockerfile.includes("COPY . ."), "Container copies the project indiscriminately instead of using an allowlist.");
assert(!/(?:COPY|ADD)[^\n]*(?:\.env|data\/|tests\/|docs\/|NEXT_STEPS|RECOVERY|\.git)/i.test(dockerfile), "Container explicitly copies a secret, private-data or non-runtime path.");
assert(dockerfile.includes("RUN install -d -o node -g node /var/lib/tideway") && dockerfile.includes("USER node"), "Container does not prepare private storage and drop root privileges.");
assert(dockerfile.includes("DATA_DIR=/var/lib/tideway") && dockerfile.includes("MARKETPLACE_ENABLED=false") && dockerfile.includes("PAYMENTS_ENABLED=false") && dockerfile.includes("LAN_PORT=0"), "Container does not default to the fail-closed public-site mode.");
assert(dockerfile.includes("STOPSIGNAL SIGTERM") && dockerfile.includes('CMD ["node", "server.mjs"]'), "Container does not preserve Tideway's graceful production lifecycle.");
assert(dockerfile.includes("HEALTHCHECK") && dockerfile.includes("/api/health") && dockerfile.includes("b.service==='tideway-marketplace'"), "Container health check does not verify the Tideway health contract.");

const ignoreLines = dockerignore.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
assert.equal(ignoreLines[0], "**", "Container context must deny everything before its explicit allowlist.");
assert(!ignoreLines.some((line) => /^!(?:\.env|data(?:\/|$)|tests(?:\/|$)|docs(?:\/|$)|\.git(?:\/|$)|NEXT_STEPS|RECOVERY)/i.test(line)), "Container context allowlists secrets, private data or non-runtime material.");
assert(ignoreLines.includes("public/tracking-test.html") && ignoreLines.includes("public/tracking-test.js"), "Production context does not remove the local browser tracking lab.");
for (const required of ["!package.json", "!pnpm-lock.yaml", "!server.mjs", "!public/**", "!src/**", "!scripts/marketplace-worker.mjs", "!tools/check-dependency-lock.mjs"]) {
  assert(ignoreLines.includes(required), `Container context omitted required runtime input ${required}.`);
}

const rootImports = [...server.matchAll(/from\s+["']\.\/([^"']+)["']/g)].map((match) => match[1]).filter((value) => !value.startsWith("public/") && !value.startsWith("src/"));
for (const imported of rootImports) {
  assert(dockerfile.includes(imported), `Container runtime omits the server dependency ${imported}.`);
  assert(ignoreLines.includes(`!${imported}`), `Container context excludes the server dependency ${imported}.`);
}

assert.equal(manifest.private, true, "Deployable package must remain private.");
assert.equal(manifest.packageManager, "pnpm@11.7.0", "Container package manager drifted from the reviewed manifest.");
assert.equal(Object.hasOwn(manifest, "devDependencies"), false, "Production package unexpectedly has a development dependency graph.");

console.log("Container deployment tests passed: explicit runtime allowlist, private-data/secret exclusion, locked production dependencies, non-root runtime, fail-closed flags, graceful stop and health contract.");
