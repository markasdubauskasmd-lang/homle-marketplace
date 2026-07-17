import { createAccountSecurity } from "./account-security.mjs";
import { createAccountSessionService } from "./account-session-service.mjs";
import { createAuthenticationRepository } from "./auth-repository.mjs";
import { createAuthenticationHttpRouter } from "./authentication-http.mjs";
import { createCredentialService } from "./credential-service.mjs";
import { createMarketplaceDatabase } from "./database.mjs";
import { createFacebookDataDeletionRepository } from "./facebook-data-deletion-repository.mjs";
import { createFacebookDataDeletionService } from "./facebook-data-deletion.mjs";
import { createFacebookIdentityService } from "./facebook-identity-service.mjs";
import { createFacebookLoginProvider } from "./facebook-login.mjs";
import { createGoogleOidcProvider } from "./google-oidc.mjs";
import { createIdentityService } from "./identity-service.mjs";
import { marketplaceEnvironment, validateMarketplaceEnvironment } from "./config.mjs";
import { createProviderLinkState } from "./provider-link-state.mjs";
import { createStagingAccountAccess } from "./staging-account-access.mjs";

export function createAuthenticationRuntime(pool, options = {}) {
  const env = options.env || process.env;
  const validation = validateMarketplaceEnvironment(env);
  if (!validation.ok) throw new TypeError(`Authentication runtime configuration is invalid: ${validation.errors.join(" ")}`);
  const environment = marketplaceEnvironment(env);
  const required = [];
  if (!environment.databaseConfigured) required.push("DATABASE_URL");
  if (!environment.sessionConfigured) required.push("SESSION_SECRET");
  if (!environment.authTokenConfigured) required.push("AUTH_TOKEN_SECRET");
  if (!environment.appOrigin) required.push("APP_ORIGIN");
  if (!environment.emailConfigured) required.push("EMAIL_FROM and an email provider");
  if (required.length) throw new TypeError(`Authentication runtime is unavailable; configure ${required.join(", ")}.`);
  if (!options.emailDelivery || typeof options.emailDelivery.send !== "function") throw new TypeError("Authentication runtime requires trusted email delivery.");
  if (!options.rateLimiter || typeof options.rateLimiter.consume !== "function" || typeof options.clientKey !== "function") throw new TypeError("Authentication runtime requires a shared rate limiter and trusted client-key resolver.");

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
  const router = createAuthenticationHttpRouter({
    security,
    credentialService,
    identityService,
    facebookIdentityService,
    facebookDataDeletionService,
    providerLinkState,
    accountSessionService,
    emailDelivery: options.emailDelivery,
    rateLimiter: options.rateLimiter,
    googleOidcProvider,
    facebookLoginProvider
  }, { appOrigin: environment.appOrigin, clientKey: options.clientKey, onUnexpectedError: options.onUnexpectedError });

  return Object.freeze({
    database,
    authenticationRepository,
    stagingAccountAccess,
    identityService,
    googleOidcProvider,
    facebookLoginProvider,
    facebookIdentityService,
    facebookDataDeletionRepository,
    facebookDataDeletionService,
    providerLinkState,
    credentialService,
    accountSessionService,
    security,
    router,
    authenticationHttpReady: true,
    googleOidcReady: googleOidcProvider !== null,
    facebookLoginReady: facebookLoginProvider !== null && facebookDataDeletionService !== null
  });
}
