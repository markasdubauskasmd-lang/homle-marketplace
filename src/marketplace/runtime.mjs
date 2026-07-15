import { createAccountSecurity } from "./account-security.mjs";
import { createAccountSessionService } from "./account-session-service.mjs";
import { createAuthenticationRepository } from "./auth-repository.mjs";
import { createAuthenticationHttpRouter } from "./authentication-http.mjs";
import { createCleanerProfileService } from "./cleaner-profile.mjs";
import { createCleanerProfileRepository } from "./cleaner-repository.mjs";
import { createBookingRepository } from "./booking-repository.mjs";
import { bookingPricingPolicyFromEnvironment, createBookingWorkflowService } from "./booking-workflow.mjs";
import { createMatchingRepository } from "./matching-repository.mjs";
import { createMatchingService } from "./matching-service.mjs";
import { createCleaningRequestRepository } from "./cleaning-request-repository.mjs";
import { createCleaningRequestService } from "./cleaning-request-service.mjs";
import { marketplaceEnvironment, validateMarketplaceEnvironment } from "./config.mjs";
import { createCredentialService } from "./credential-service.mjs";
import { createMarketplaceDatabase } from "./database.mjs";
import { createIdentityService } from "./identity-service.mjs";
import { createJourneyRepository } from "./journey-repository.mjs";
import { createJourneyService } from "./journey-service.mjs";
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
  if (!environment.authTokenConfigured) required.push("AUTH_TOKEN_SECRET");
  if (!environment.appOrigin) required.push("APP_ORIGIN");
  if (!environment.encryptionConfigured) required.push("DATA_ENCRYPTION_KEY");
  if (required.length) throw new TypeError(`Marketplace runtime is unavailable; configure ${required.join(", ")}.`);

  const database = createMarketplaceDatabase(pool);
  const authenticationRepository = createAuthenticationRepository(database);
  const identityService = createIdentityService(authenticationRepository);
  const credentialService = createCredentialService(authenticationRepository, { tokenSecret: env.AUTH_TOKEN_SECRET });
  const accountSessionService = createAccountSessionService(authenticationRepository, { sessionSecret: env.SESSION_SECRET, production: environment.production });
  const security = createAccountSecurity(authenticationRepository, {
    sessionSecret: env.SESSION_SECRET,
    appOrigin: environment.appOrigin,
    production: environment.production
  });
  const cleanerProfileRepository = createCleanerProfileRepository(database);
  const cleanerProfileService = createCleanerProfileService(cleanerProfileRepository);
  const propertyRepository = createPropertyRepository(database);
  const propertyService = createPropertyService(propertyRepository, { dataEncryptionSecret: env.DATA_ENCRYPTION_KEY });
  const cleaningRequestRepository = createCleaningRequestRepository(database);
  const cleaningRequestService = createCleaningRequestService(cleaningRequestRepository);
  const bookingRepository = createBookingRepository(database);
  const bookingPricingPolicy = options.bookingPricingPolicy || bookingPricingPolicyFromEnvironment(env);
  const bookingWorkflowService = createBookingWorkflowService(bookingRepository, { pricingPolicy: bookingPricingPolicy });
  const matchingRepository = createMatchingRepository(database);
  const matchingService = createMatchingService(matchingRepository, { pricingPolicy: bookingPricingPolicy });
  const journeyRepository = createJourneyRepository(database);
  const journeyService = createJourneyService(journeyRepository, { etaProvider: options.etaProvider });
  const marketplaceRouter = createMarketplaceHttpRouter({ security, cleanerProfileService, propertyService, cleaningRequestService, bookingWorkflowService, matchingService, journeyService }, { onUnexpectedError: options.onUnexpectedError });
  const authenticationDependencies = [options.emailDelivery, options.rateLimiter, options.clientKey];
  const suppliedAuthenticationDependencies = authenticationDependencies.filter(Boolean).length;
  if (suppliedAuthenticationDependencies > 0 && suppliedAuthenticationDependencies < authenticationDependencies.length) throw new TypeError("Authentication HTTP composition requires email delivery, shared rate limiting and a trusted client-key resolver together.");
  if (suppliedAuthenticationDependencies === authenticationDependencies.length && !environment.emailConfigured) throw new TypeError("Authentication HTTP composition requires SMTP_URL and EMAIL_FROM configuration.");
  const authenticationRouter = suppliedAuthenticationDependencies === authenticationDependencies.length
    ? createAuthenticationHttpRouter({ security, credentialService, identityService, accountSessionService, emailDelivery: options.emailDelivery, rateLimiter: options.rateLimiter }, { appOrigin: environment.appOrigin, clientKey: options.clientKey, onUnexpectedError: options.onUnexpectedError })
    : null;
  const router = authenticationRouter ? {
    async handle(request, response, url) {
      if (await authenticationRouter.handle(request, response, url)) return true;
      return marketplaceRouter.handle(request, response, url);
    }
  } : marketplaceRouter;

  return Object.freeze({
    database,
    authenticationRepository,
    identityService,
    credentialService,
    accountSessionService,
    security,
    cleanerProfileRepository,
    cleanerProfileService,
    propertyRepository,
    propertyService,
    cleaningRequestRepository,
    cleaningRequestService,
    bookingRepository,
    bookingWorkflowService,
    matchingRepository,
    matchingService,
    journeyRepository,
    journeyService,
    authenticationRouter,
    authenticationHttpReady: authenticationRouter !== null,
    marketplaceRouter,
    router
  });
}
