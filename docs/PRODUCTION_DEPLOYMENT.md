# Production deployment gate

Homle supports two deliberately separate production modes:

- **Public site:** the reviewed independent website and concierge pilot, with `MARKETPLACE_ENABLED=false` and `PAYMENTS_ENABLED=false`.
- **Marketplace:** authenticated PostgreSQL accounts, private media and live booking workflows, enabled only after every managed staging dependency passes.

The public-site mode no longer requires placeholder database credentials. It remains detached from marketplace authentication and payments, and `/api/auth/providers` must report every provider as unavailable.

`PILOT_INTAKE_ENABLED` independently controls the legacy file-backed concierge intake. Production must set it explicitly. Keep it `false` for a visual preview or any host with temporary storage. Set it `true` only after an encrypted durable volume is mounted at `DATA_DIR`, retention/backup operations are ready and real intake is separately approved. It must remain `false` when the PostgreSQL marketplace is enabled so one deployment cannot write private records to two unrelated systems.

## Host-neutral container artifact

`Dockerfile` is the prepared production build boundary. It uses the exact Node 24.17.0 Bookworm-slim tag in two stages, verifies the locked dependency graph before a frozen production-only install, and copies only the runtime files. `.dockerignore` denies the whole workspace first and then allowlists those inputs. It excludes `.env`, private `data`, Git history, tests, launch notes and the browser-facing local tracking-lab assets. The final process runs as the image's unprivileged `node` user, defaults both marketplace and payments off, uses `/var/lib/tideway` outside the application source, handles `SIGTERM`, and checks the public health contract without adding `curl`.

The Docker build also requires Render's non-secret `RENDER_GIT_COMMIT` build argument. Render provides the exact commit SHA at build time and translates service environment values into Docker build arguments. The build validates that full 40-character SHA, validates the ordered migration lock, then creates a no-overwrite `homle-release.json` inside the image. The web process and worker therefore expose and enforce the same eight-character release identity. A missing, malformed or mismatched commit fails the image build instead of producing an unidentified deployment. Do not manually set `RENDER_GIT_COMMIT` in the Render Dashboard; use Render's platform-provided value.

Docker is not installed on the current development computer, so the repository test proves the source contract but **not** a successful image build, native Sharp load, image vulnerability state or hosting behavior. On the selected host/build service, record the exact release commit and run:

```text
docker build --pull --build-arg RENDER_GIT_COMMIT=<full-40-character-release-commit> --tag homle:<eight-character-release-commit> .
docker run --rm --entrypoint node homle:<eight-character-release-commit> --version
docker run --rm --entrypoint node homle:<eight-character-release-commit> -e "Promise.all([import('pg'),import('sharp'),import('nodemailer'),import('@aws-sdk/client-s3'),import('stripe')]).then(()=>console.log('runtime dependencies load')).catch(error=>{console.error(error.message);process.exit(1)})"
```

Record the resolved base/image digest and scan the **built image**, not only the JavaScript lockfile, with the approved host scanner before deployment. Do not launch with an unresolved critical/high finding merely because `pnpm audit` is green; base operating-system and bundled-tool findings are a separate boundary. Review and rebuild after any base-tag change.

For runtime, mount an encrypted persistent volume at `/var/lib/tideway`, confirm it is writable by the container's `node` user, keep the root filesystem read-only where the host supports it, drop Linux capabilities, and set `no-new-privileges`. Do not place secrets in build arguments, image layers or an environment file committed beside the source. The real domain, Administrator key and exact immediate-proxy CIDRs must come from the hosting secret/configuration service. The existing production preflight intentionally prevents the image from starting without them.

## Render staging Blueprint

The root `render.yaml` defines one free Docker web service and one owner-approved free PostgreSQL 16 staging database in Frankfurt. It disables automatic source deployment, pins the exact assigned preview `APP_ORIGIN`, generates the Administrator and restricted-role secrets, and keeps pilot intake, marketplace accounts, every worker capability and payments off. The database uses the guarded `_homle_staging` name, a distinct migration-owner login and no public IP allow-list. It creates no worker, disk or custom domain. The owner explicitly approved the free staging database on 17 July 2026.

The Docker entrypoint connects over Render's private database reference before starting the web process. It requires the exact staging suffix, PostgreSQL 16+, a separate non-superuser migration owner, an empty schema and valid locked migration checksums. A production connection uses verified TLS everywhere except Render's documented same-workspace internal `dpg-*` hostname: that narrowly recognised target uses Render's private-network transport and never traverses the public internet. The exemption requires Render's platform identity and a Render web, worker, private or cron service type, and is enforced for both the web runtime and the restricted maintenance worker. An external, dotted, IP-based or non-Render target still requires certificate verification and cannot request `sslmode=disable`. It creates or rotates the two least-privilege login roles without putting their passwords into SQL text, applies all 45 migrations and both grant files once, and requires the read-only deployment verifier. A later restart verifies an existing schema before rotating either role and never replays migrations. Any partial or unexpected database fails closed. The web service then remains intentionally read-only until account email, private object storage, monitoring and authentication provider credentials pass the guarded staging checks.

The Blueprint asks Render to generate independent 256-bit values for `SESSION_SECRET`, `AUTH_TOKEN_SECRET` and `DATA_ENCRYPTION_KEY` only when each variable does not already exist. Their values never enter Git or deployment output. These application secrets are distinct from the generated database-role and Administrator credentials; adding them does not enable the marketplace or payments.

Render documents that free web services use an ephemeral filesystem, cannot attach a persistent disk, spin down when idle and are not for production applications. A free Render PostgreSQL database is limited to 1 GB, has no backups or managed pooling and expires after 30 days. Render also does not offer a free background-worker instance. This foundation is for time-boxed real mobile testing, not production launch. See Render's [free-instance limits](https://render.com/docs/free) and [current Blueprint specification](https://render.com/docs/blueprint-spec).

Do not enable intake or marketplace capabilities merely because the database bootstrap passes. First record the safe bootstrap result and connect the remaining private services. Before any later sync, review the displayed resources and confirm that no paid resource or domain has been added. A real launch requires the managed PostgreSQL/SMTP/private-object-storage/monitoring promotion described below. The marketplace additionally needs a paid worker; payments remain a later separately approved gate.

## Mandatory preflight

Every public production process must provide:

```text
NODE_ENV=production
HOST=<explicit application binding>
PORT=<platform application port>
LAN_PORT=0
APP_ORIGIN=https://<canonical-public-domain>
DATA_DIR=<absolute private directory outside the deployed source and cloud-sync folders>
ADMIN_REQUIRE_KEY=true
ADMIN_KEY=<secret-manager value of at least 32 characters>
TRUST_PROXY=true
TRUST_PROXY_PROVIDER=render
TRUSTED_PROXY_CIDRS=
PILOT_INTAKE_ENABLED=false
MARKETPLACE_ENABLED=false
PAYMENTS_ENABLED=false
```

`HOST` may be `127.0.0.1` when a same-host reverse proxy is the only caller, or a reviewed interface binding such as `0.0.0.0` inside an isolated container network. Render mode additionally requires the platform-provided `RENDER=true`, `RENDER_SERVICE_ID` and `RENDER_EXTERNAL_HOSTNAME` runtime values and accepts a bounded forwarding chain using Render's documented first-address client identity. Do not manually set those platform values. For a different host, leave `TRUST_PROXY_PROVIDER` blank, configure the actual immediate proxy networks in `TRUSTED_PROXY_CIDRS`, and require that proxy to replace forwarding input with exactly one address.

Store `ADMIN_KEY` and every future provider credential in the hosting secret manager. Do not place them in `.env`, source control, build logs, screenshots or chat.

Run before starting the deployed process:

```text
pnpm run preflight:production
```

The preflight performs no DNS change, deployment, database connection, email, storage request or provider call. It prints only safe booleans and the selected mode; failures name missing controls without printing their values. The production server repeats the same validation before opening its listening socket, preventing a platform from bypassing the operator command.

## Public-site deployment sequence

1. Select hosting and record its deployment identity, region, persistent-volume behavior, HTTPS proxy behavior and immediate proxy networks.
2. Put private pilot data on an encrypted persistent volume or access-restricted host directory. Never use the source checkout or an ephemeral filesystem for real submissions. Keep `PILOT_INTAKE_ENABLED=false` until this is proven.
3. Configure the mandatory environment through the platform secret manager and keep marketplace, workers and payments false. Turn pilot intake on only for the separately approved durable concierge deployment.
4. Run the dependency lock, complete tests and production preflight against the exact release commit. If using the container artifact, also build it on the selected Linux builder, load every native/runtime dependency, record its digest and pass the approved image scan.
5. Start the process and require `/api/health` to return HTTP 200, `ok: true`, healthy integrity, `marketplace.enabled: false` and `localDemosEnabled: false` with `Cache-Control: no-store`. A read-only preview must additionally report `pilot.intakeEnabled: false` and reject every legacy mutation with HTTP 503. An approved durable concierge deployment must report `pilot.intakeEnabled: true` before accepting its first synthetic submission.
6. Verify `/api/auth/providers` reports Google, Facebook, Apple and email/password as false.
7. Verify `/tracking-test`, `/tracking-test.html`, `/tracking-test.js` and `/api/tracking-test/session` all return 404. The real-location simulator is a local development lab, not a public feature.
8. Connect the approved domain only after external `tools/domain-readiness.mjs` passes. Its read-only probes independently require the production health flag, anonymous `/admin` denial and closed local tracking surfaces without redirects, cacheable responses or cookies. This action still requires founder approval; preparation is not authorization to publish.
9. Submit only synthetic records during staging, verify the control desk and remove every synthetic record before real intake.

## Marketplace promotion

Do not change `MARKETPLACE_ENABLED` until managed PostgreSQL, SMTP, private object storage, monitoring, proxy identity, migrations/grants and two-account HTTPS tests pass. Marketplace mode additionally requires a normal request `DATABASE_URL`, a direct session-capable `REALTIME_DATABASE_URL` to the same database, separate session/token/encryption credentials, SMTP sender and private-storage settings. Transaction pooling is suitable for the normal URL after load testing but not for the real-time URL because booking updates use PostgreSQL `LISTEN/NOTIFY`. Use the shipped `homle:monitoring-webhook` module with an approved private HTTPS collector and secret, or a reviewed absolute custom adapter implementing the same monitoring/shutdown contract. Startup connects to and verifies each dependency before it exposes an account route.

Keep `PAYMENTS_ENABLED=false` until the founder approves the legal/payment model and an approved Stripe test platform completes the documented authorization, completion, capture, transfer, cancellation and refund rehearsal. Configuration now rejects payments when the marketplace is detached.

## Rollback boundary

- Disable traffic at the host or return to the last verified application release; do not reverse already-applied PostgreSQL migrations.
- Keep marketplace, worker and payments flags false while diagnosing an uncertain release.
- Preserve private volumes and database evidence. Never replace or delete them as part of an application rollback.
- Require healthy integrity and expected record counts before restoring traffic.
- Re-run the production preflight and external domain verifier after any host, proxy, domain or release change.
