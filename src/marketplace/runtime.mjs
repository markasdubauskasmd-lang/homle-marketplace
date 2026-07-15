import { createAccountSecurity } from "./account-security.mjs";
import { createAuthenticationRepository } from "./auth-repository.mjs";
import { createCleanerProfileService } from "./cleaner-profile.mjs";
import { createCleanerProfileRepository } from "./cleaner-repository.mjs";
import { marketplaceEnvironment, validateMarketplaceEnvironment } from "./config.mjs";
import { createMarketplaceDatabase } from "./database.mjs";
import { createMarketplaceHttpRouter } from "./marketplace-http.mjs";
import { createPropertyRepository } from "./property-repository.mjs";
import { createPropertyService } from "./property-service.mjs";

export function createMarketplaceRuntime(pool, options = {}) {
  const env = options.env || process.env;
  const validation = validateMarketplaceEnvironment(env);
  if (!validation.ok) throw new TypeError(`Marketplace runtime configuration is invalid: ${validation.errors.join(" ")}`);
  const environment = marketplaceEnvironment(env);
  const required = [];
  if (!environment.databaseConfigured) required.push("DATABASE_URL");
  if (!environment.sessionConfigured) required.push("SESSION_SECRET");
  if (!environment.appOrigin) required.push("APP_ORIGIN");
  if (!environment.encryptionConfigured) required.push("DATA_ENCRYPTION_KEY");
  if (required.length) throw new TypeError(`Marketplace runtime is unavailable; configure ${required.join(", ")}.`);

  const database = createMarketplaceDatabase(pool);
  const authenticationRepository = createAuthenticationRepository(database);
  const security = createAccountSecurity(authenticationRepository, {
    sessionSecret: env.SESSION_SECRET,
    appOrigin: environment.appOrigin,
    production: environment.production
  });
  const cleanerProfileRepository = createCleanerProfileRepository(database);
  const cleanerProfileService = createCleanerProfileService(cleanerProfileRepository);
  const propertyRepository = createPropertyRepository(database);
  const propertyService = createPropertyService(propertyRepository, { dataEncryptionSecret: env.DATA_ENCRYPTION_KEY });
  const router = createMarketplaceHttpRouter({ security, cleanerProfileService, propertyService }, { onUnexpectedError: options.onUnexpectedError });

  return Object.freeze({
    database,
    authenticationRepository,
    security,
    cleanerProfileRepository,
    cleanerProfileService,
    propertyRepository,
    propertyService,
    router
  });
}
