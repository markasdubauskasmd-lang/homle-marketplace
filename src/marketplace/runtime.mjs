import { createAccountSecurity } from "./account-security.mjs";
import { createAccountSessionService } from "./account-session-service.mjs";
import { createAuthenticationRepository } from "./auth-repository.mjs";
import { createAuthenticationHttpRouter } from "./authentication-http.mjs";
import { createCleanerProfileService } from "./cleaner-profile.mjs";
import { createCleanerProfileRepository } from "./cleaner-repository.mjs";
import { createBookingRepository } from "./booking-repository.mjs";
import { bookingPricingPolicyFromEnvironment, createBookingWorkflowService } from "./booking-workflow.mjs";
import { createPaymentRepository } from "./payment-repository.mjs";
import { createPaymentService } from "./payment-service.mjs";
import { createCleanerPayoutRepository } from "./cleaner-payout-repository.mjs";
import { createCleanerPayoutService } from "./cleaner-payout-service.mjs";
import { createMatchingRepository } from "./matching-repository.mjs";
import { createMatchingService } from "./matching-service.mjs";
import { createCleaningRequestRepository } from "./cleaning-request-repository.mjs";
import { createCleaningRequestService } from "./cleaning-request-service.mjs";
import { marketplaceEnvironment, validateMarketplaceEnvironment } from "./config.mjs";
import { createCredentialService } from "./credential-service.mjs";
import { createMarketplaceDatabase } from "./database.mjs";
import { createIdentityService } from "./identity-service.mjs";
import { createGoogleOidcProvider } from "./google-oidc.mjs";
import { createAppleSignInProvider } from "./apple-sign-in.mjs";
import { createFacebookLoginProvider } from "./facebook-login.mjs";
import { createFacebookIdentityService } from "./facebook-identity-service.mjs";
import { createFacebookDataDeletionRepository } from "./facebook-data-deletion-repository.mjs";
import { createFacebookDataDeletionService } from "./facebook-data-deletion.mjs";
import { createProviderLinkState } from "./provider-link-state.mjs";
import { createJourneyRepository } from "./journey-repository.mjs";
import { createJourneyService } from "./journey-service.mjs";
import { createMarketplaceHttpRouter } from "./marketplace-http.mjs";
import { createPropertyRepository } from "./property-repository.mjs";
import { createPropertyService } from "./property-service.mjs";
import { geocoderFromEnvironment } from "./postcode-geocoder.mjs";
import { speechSummaryFromEnvironment } from "./speech-summary.mjs";
import { roomVisionFromEnvironment } from "./room-vision.mjs";
import { etaProviderFromEnvironment } from "./straight-line-eta.mjs";
import { createProgressRepository } from "./progress-repository.mjs";
import { createProgressService } from "./progress-service.mjs";
import { createMediaRepository } from "./media-repository.mjs";
import { createMediaService } from "./media-service.mjs";
import { createRequestMediaRepository } from "./request-media-repository.mjs";
import { createRequestMediaService } from "./request-media-service.mjs";
import { createMessageRepository } from "./message-repository.mjs";
import { createMessageService } from "./message-service.mjs";
import { createRealtimeRepository } from "./realtime-repository.mjs";
import { createPostgresRealtimeSignalSource } from "./realtime-signal-source.mjs";
import { createRealtimeService } from "./realtime-service.mjs";
import { createNotificationRepository } from "./notification-repository.mjs";
import { createNotificationService } from "./notification-service.mjs";
import { createReviewRepository } from "./review-repository.mjs";
import { createReviewService } from "./review-service.mjs";
import { createDisputeRepository } from "./dispute-repository.mjs";
import { createDisputeService } from "./dispute-service.mjs";
import { createPrivacyRequestRepository } from "./privacy-request-repository.mjs";
import { createPrivacyRequestService } from "./privacy-request-service.mjs";
import { createStagingAccountAccess } from "./staging-account-access.mjs";
import { createAdministratorBookingRepository } from "./administrator-booking-repository.mjs";
import { createAdministratorBookingService } from "./administrator-booking-service.mjs";
import { createAdministratorVerificationRepository } from "./administrator-verification-repository.mjs";
import { createAdministratorVerificationService } from "./administrator-verification-service.mjs";
import { createFavouriteCleanerRepository } from "./favourite-cleaner-repository.mjs";
import { createFavouriteCleanerService } from "./favourite-cleaner-service.mjs";

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
  if (!options.rateLimiter || typeof options.rateLimiter.consume !== "function" || typeof options.clientKey !== "function") throw new TypeError("Marketplace runtime composition requires a shared rate limiter and trusted client-key resolver.");

  const database = createMarketplaceDatabase(pool);
  const authenticationRepository = createAuthenticationRepository(database);
  const stagingAccountAccess = createStagingAccountAccess(env);
  const identityService = createIdentityService(authenticationRepository, { accountAccess: stagingAccountAccess });
  const googleOidcProvider = options.googleOidcProvider || (environment.providers.google.enabled
    ? createGoogleOidcProvider({
      appOrigin: environment.appOrigin,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      stateSecret: env.AUTH_TOKEN_SECRET,
      fetch: options.googleFetch
    })
    : null);
  const appleSignInProvider = options.appleSignInProvider || (environment.providers.apple.enabled
    ? createAppleSignInProvider({
      appOrigin: environment.appOrigin,
      clientId: env.APPLE_CLIENT_ID,
      teamId: env.APPLE_TEAM_ID,
      keyId: env.APPLE_KEY_ID,
      privateKey: env.APPLE_PRIVATE_KEY,
      stateSecret: env.AUTH_TOKEN_SECRET,
      fetch: options.appleFetch
    })
    : null);
  const facebookLoginProvider = options.facebookLoginProvider || (environment.providers.facebook.enabled
    ? createFacebookLoginProvider({
      appOrigin: environment.appOrigin,
      appId: env.FACEBOOK_APP_ID,
      appSecret: env.FACEBOOK_APP_SECRET,
      graphVersion: env.FACEBOOK_GRAPH_API_VERSION,
      stateSecret: env.AUTH_TOKEN_SECRET,
      fetch: options.facebookFetch
    })
    : null);
  const facebookIdentityService = createFacebookIdentityService(authenticationRepository, { tokenSecret: env.AUTH_TOKEN_SECRET, accountAccess: stagingAccountAccess });
  const facebookDataDeletionRepository = createFacebookDataDeletionRepository(database);
  const facebookDataDeletionService = facebookLoginProvider
    ? createFacebookDataDeletionService(facebookDataDeletionRepository, {
      appOrigin: environment.appOrigin,
      appSecret: env.FACEBOOK_APP_SECRET,
      tokenSecret: env.AUTH_TOKEN_SECRET
    })
    : null;
  const providerLinkState = createProviderLinkState({ secret: env.AUTH_TOKEN_SECRET, appOrigin: environment.appOrigin });
  const credentialService = createCredentialService(authenticationRepository, { tokenSecret: env.AUTH_TOKEN_SECRET, accountAccess: stagingAccountAccess });
  const accountSessionService = createAccountSessionService(authenticationRepository, { sessionSecret: env.SESSION_SECRET, production: environment.production });
  const security = createAccountSecurity(authenticationRepository, {
    sessionSecret: env.SESSION_SECRET,
    appOrigin: environment.appOrigin,
    production: environment.production
  });
  const geocoder = options.geocoder || geocoderFromEnvironment(env);
  // Optional assisted understanding of the dictated walkthrough. Absent
  // configuration leaves the on-device parser as the only path.
  const speechSummary = options.speechSummary || speechSummaryFromEnvironment(env);
  // Optional assisted reading of captured room photographs.
  const roomVision = options.roomVision || roomVisionFromEnvironment(env);
  const cleanerProfileRepository = createCleanerProfileRepository(database);
  const cleanerProfileService = createCleanerProfileService(cleanerProfileRepository, { geocoder });
  const favouriteCleanerRepository = createFavouriteCleanerRepository(database);
  const favouriteCleanerService = createFavouriteCleanerService(favouriteCleanerRepository);
  const propertyRepository = createPropertyRepository(database);
  const propertyService = createPropertyService(propertyRepository, { dataEncryptionSecret: env.DATA_ENCRYPTION_KEY, geocoder });
  const cleaningRequestRepository = createCleaningRequestRepository(database);
  const cleaningRequestService = createCleaningRequestService(cleaningRequestRepository);
  const bookingRepository = createBookingRepository(database);
  const bookingPricingPolicy = options.bookingPricingPolicy || bookingPricingPolicyFromEnvironment(env);
  const bookingWorkflowService = createBookingWorkflowService(bookingRepository, { pricingPolicy: bookingPricingPolicy });
  const paymentRepository = createPaymentRepository(database);
  const paymentService = options.paymentProvider ? createPaymentService(paymentRepository, options.paymentProvider, { publishableKey: env.STRIPE_PUBLISHABLE_KEY }) : null;
  const cleanerPayoutRepository = createCleanerPayoutRepository(database);
  const cleanerPayoutService = options.paymentProvider ? createCleanerPayoutService(cleanerPayoutRepository, options.paymentProvider, { appOrigin: environment.appOrigin }) : null;
  const matchingRepository = createMatchingRepository(database);
  const matchingService = createMatchingService(matchingRepository, { pricingPolicy: bookingPricingPolicy });
  const journeyRepository = createJourneyRepository(database);
  const journeyService = createJourneyService(journeyRepository, { etaProvider: options.etaProvider === undefined ? etaProviderFromEnvironment(env) : options.etaProvider });
  const progressRepository = createProgressRepository(database);
  const progressService = createProgressService(progressRepository);
  const mediaRepository = createMediaRepository(database);
  const mediaService = createMediaService(mediaRepository, { objectStorage: options.objectStorage });
  const requestMediaRepository = createRequestMediaRepository(database);
  const requestMediaService = createRequestMediaService(requestMediaRepository, { objectStorage: options.objectStorage });
  const messageRepository = createMessageRepository(database);
  const messageService = createMessageService(messageRepository);
  const realtimeRepository = createRealtimeRepository(database);
  const realtimeSignalSource = options.realtimeSignalSource || createPostgresRealtimeSignalSource(pool);
  const realtimeService = createRealtimeService(realtimeRepository, realtimeSignalSource, options.realtimeOptions);
  const notificationRepository = createNotificationRepository(database);
  const notificationService = createNotificationService(notificationRepository);
  const reviewRepository = createReviewRepository(database);
  const reviewService = createReviewService(reviewRepository);
  const disputeRepository = createDisputeRepository(database);
  const disputeService = createDisputeService(disputeRepository);
  const administratorBookingRepository = createAdministratorBookingRepository(database);
  const administratorBookingService = createAdministratorBookingService(administratorBookingRepository);
  const administratorVerificationRepository = createAdministratorVerificationRepository(database);
  const administratorVerificationService = createAdministratorVerificationService(administratorVerificationRepository);
  const privacyRequestRepository = createPrivacyRequestRepository(database);
  const privacyRequestService = createPrivacyRequestService(privacyRequestRepository);
  const marketplaceRouter = createMarketplaceHttpRouter({ security, cleanerProfileService, favouriteCleanerService, propertyService, cleaningRequestService, bookingWorkflowService, matchingService, journeyService, progressService, mediaService, requestMediaService, messageService, realtimeService, notificationService, reviewService, disputeService, administratorBookingService, administratorVerificationService, privacyRequestService, paymentService, cleanerPayoutService, speechSummary, roomVision, rateLimiter: options.rateLimiter }, { clientKey: options.clientKey, onUnexpectedError: options.onUnexpectedError });
  if (options.emailDelivery && !environment.emailConfigured) throw new TypeError("Authentication HTTP composition requires one configured HTTPS or SMTP email provider and EMAIL_FROM.");
  const authenticationRouter = options.emailDelivery || googleOidcProvider || appleSignInProvider
    ? createAuthenticationHttpRouter({ security, credentialService, identityService, facebookIdentityService, facebookDataDeletionService, providerLinkState, accountSessionService, emailDelivery: options.emailDelivery, rateLimiter: options.rateLimiter, googleOidcProvider, appleSignInProvider, facebookLoginProvider }, { appOrigin: environment.appOrigin, clientKey: options.clientKey, onUnexpectedError: options.onUnexpectedError, workspaceReady: true })
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
    stagingAccountAccess,
    identityService,
    googleOidcProvider,
    appleSignInProvider,
    facebookLoginProvider,
    facebookIdentityService,
    facebookDataDeletionRepository,
    facebookDataDeletionService,
    providerLinkState,
    credentialService,
    accountSessionService,
    security,
    cleanerProfileRepository,
    cleanerProfileService,
    favouriteCleanerRepository,
    favouriteCleanerService,
    propertyRepository,
    propertyService,
    cleaningRequestRepository,
    cleaningRequestService,
    bookingRepository,
    bookingWorkflowService,
    geocodingReady: geocoder !== null,
    speechSummary,
    speechSummaryReady: speechSummary !== null,
    roomVision,
    roomVisionReady: roomVision !== null,
    matchingReady: bookingPricingPolicy !== null,
    paymentRepository,
    paymentService,
    cleanerPayoutRepository,
    cleanerPayoutService,
    paymentReady: paymentService !== null,
    matchingRepository,
    matchingService,
    journeyRepository,
    journeyService,
    progressRepository,
    progressService,
    mediaRepository,
    mediaService,
    requestMediaRepository,
    requestMediaService,
    messageRepository,
    messageService,
    realtimeRepository,
    realtimeSignalSource,
    realtimeService,
    notificationRepository,
    notificationService,
    reviewRepository,
    reviewService,
    disputeRepository,
    disputeService,
    administratorBookingRepository,
    administratorBookingService,
    administratorVerificationService,
    privacyRequestRepository,
    privacyRequestService,
    authenticationRouter,
    authenticationHttpReady: authenticationRouter !== null,
    googleOidcReady: authenticationRouter !== null && googleOidcProvider !== null,
    appleSignInReady: authenticationRouter !== null && appleSignInProvider !== null,
    facebookLoginReady: authenticationRouter !== null && facebookLoginProvider !== null && facebookDataDeletionService !== null,
    marketplaceRouter,
    router
  });
}
