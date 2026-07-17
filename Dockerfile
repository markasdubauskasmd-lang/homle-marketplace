FROM node:24.17.0-bookworm-slim AS dependencies

ENV NODE_ENV=production
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY package.json pnpm-lock.yaml ./
COPY tools/check-dependency-lock.mjs ./tools/check-dependency-lock.mjs
RUN node tools/check-dependency-lock.mjs
RUN pnpm install --frozen-lockfile --prod --ignore-scripts

ARG RENDER_GIT_COMMIT
COPY release-identity.mjs ./release-identity.mjs
COPY db/migration-lock.json ./db/migration-lock.json
COPY tools/generate-container-release-identity.mjs ./tools/generate-container-release-identity.mjs
RUN node tools/generate-container-release-identity.mjs

FROM node:24.17.0-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    LAN_PORT=0 \
    PILOT_INTAKE_ENABLED=false \
    DATA_DIR=/var/lib/tideway \
    AUTHENTICATION_ENABLED=false \
    MARKETPLACE_ENABLED=false \
    PAYMENTS_ENABLED=false

WORKDIR /app
RUN install -d -o node -g node /var/lib/tideway

COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=dependencies --chown=node:node /app/homle-release.json ./homle-release.json
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node server.mjs ./server.mjs
COPY --chown=node:node business-clock.mjs cleaner-profile-starter.mjs data-directory-safety.mjs deployment-readiness.mjs lead-attention.mjs marketplace-activation-readiness.mjs offer-expiry.mjs pilot-service.mjs release-identity.mjs request-followup-draft.mjs tracking-test-store.mjs travel-coverage.mjs ./
COPY --chown=node:node public ./public
COPY --chown=node:node src ./src
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node db ./db

USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(async r=>{const b=await r.json();process.exit(r.status===200&&b.ok===true&&b.service==='tideway-marketplace'?0:1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.mjs"]
