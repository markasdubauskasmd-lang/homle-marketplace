# Optional Google Maps setup for Homle

> **Current deployment status:** Google Maps is inactive. Homle uses manual Cleaner address entry and local straight-line journey estimates, and Render does not request Google Maps API keys. The steps below are retained only if the owner decides to activate Google Maps in the future.

Homle uses Google Maps Platform for four separate functions:

- Maps JavaScript API: the Cleaner Jobs Map.
- Places API (New): address suggestions during Cleaner onboarding.
- Geocoding API: postcode coordinates used for matching.
- Routes API: road and traffic-aware journey estimates.

The cleaner's device location still comes from the browser's permission prompt. Google Maps is contacted only after the cleaner chooses **Show my location** or starts the existing consented journey flow.

## 1. Create the Google project

In Google Cloud Console, select or create the project that will belong to Homle. Attach a billing account, then enable the four APIs listed above. Set a budget alert and API quotas before using real traffic.

Do not reuse the Google Sign-In OAuth secret. Maps API keys and OAuth credentials have different security boundaries.

## 2. Create the browser key

Create an API key named `Homle Maps browser`.

Under **Application restrictions**, select **Websites** and add:

- `https://homlle.com/*`
- `https://www.homlle.com/*`
- `https://homle-marketplace-preview.onrender.com/*` while the Render preview is in use

Under **API restrictions**, allow only **Maps JavaScript API**.

Copy it to Render as `GOOGLE_MAPS_BROWSER_API_KEY`. This key is intentionally delivered to an authenticated browser; the website and API restrictions are what make it safe.

## 3. Create the server key

Create another API key named `Homle Maps server`.

Under **API restrictions**, allow only:

- Places API (New)
- Geocoding API
- Routes API

If the Render service has fixed outbound IP addresses, restrict this key to those IPs. If the selected Render plan does not provide stable outbound IPs, keep the application restriction unset but retain the strict API restrictions, quotas and usage alerts. Never put this key in browser code.

Copy it to Render as `GOOGLE_MAPS_SERVER_API_KEY`.

## 4. Set the Render environment

Only if Google Maps is approved again, change the Render environment to these values:

```text
MAP_PROVIDER=google-maps
GEOCODING_PROVIDER=google-maps
ADDRESS_LOOKUP_PROVIDER=google-maps
ETA_PROVIDER=google-maps
```

Add the two private key values in the Render service's **Environment** page, save the changes, and deploy the current code. `GOOGLE_MAPS_MAP_ID` is optional and is not needed for the standard map.

## 5. Verify safely

1. Sign in with a Cleaner staging account.
2. Open **Complete Registration → Personal Details**.
3. Search for a UK address, select a suggestion, verify all six address fields and save.
4. Reload the page and confirm the reviewed address returns from the onboarding database.
5. Open **Jobs Map** and confirm known booking areas appear as pins.
6. Press **Show my location**, approve the browser prompt and confirm the blue current-location marker appears.
7. Start a staging journey and confirm the ETA updates. If Google Routes is temporarily unavailable, Homle falls back to its local distance estimate.

Google place identifiers and raw provider responses are not saved in the Cleaner onboarding database. Only the reviewed address fields are persisted.
