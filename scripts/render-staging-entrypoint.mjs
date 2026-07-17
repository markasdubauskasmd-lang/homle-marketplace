import { bootstrapRenderStagingDatabase } from "../src/marketplace/render-staging-bootstrap.mjs";

if (process.env.NODE_ENV !== "production" || process.env.RENDER !== "true") {
  throw new Error("The Render staging entrypoint may run only inside a production Render service.");
}

const result = await bootstrapRenderStagingDatabase();
process.env.DATABASE_URL = result.runtimeUrl;
process.env.REALTIME_DATABASE_URL = result.runtimeUrl;
process.env.WORKER_DATABASE_URL = result.workerUrl;
delete process.env.DATABASE_BOOTSTRAP_URL;
delete process.env.TIDEWAY_APP_PASSWORD;
delete process.env.TIDEWAY_WORKER_PASSWORD;
delete process.env.RENDER_STAGING_BOOTSTRAP_ENABLED;
delete process.env.RENDER_STAGING_BASELINE_MIGRATION_COUNT;

console.log(`Homle staging database ${result.status}: ${result.migrationCount} locked migrations verified; ${result.appliedMigrationCount} applied during this start.`);
await import("../server.mjs");
