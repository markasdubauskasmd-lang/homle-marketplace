import { verifyDatabaseAssets } from "../db/migration-assets.mjs";

const result = await verifyDatabaseAssets();
if (!result.ok) {
  console.error("Database asset verification failed:");
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`Database assets verified: ${result.migrations.length} ordered migrations, ${result.grantFiles.length} role-grant files, PostgreSQL ${result.postgresqlMajor}+ target.`);
}
