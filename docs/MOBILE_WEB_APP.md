# Homle mobile web app

Homle is a mobile-first full-stack web application. It runs in a normal browser and can also be added to a phone home screen from its final HTTPS origin.

## Installed experience

- `site.webmanifest` owns the stable Homle name, colours, navigation scope and start route.
- Standard 192px and 512px icons support Android and desktop installation.
- A separate safe-zone 512px icon remains legible when a phone applies a circle, rounded square or other mask.
- The 180px Apple touch icon and homepage metadata support **Add to Home Screen** on iPhone and iPad.
- Installed shortcuts open the two honest public entry points: request a clean or work as a Cleaner.

## Privacy boundary

Homle deliberately does not install a service worker that caches authenticated pages, room photos, addresses, access instructions, messages, location or booking data. Private screens remain network-only and fail closed when the secure server is unavailable.

## Web limitations

- Camera, microphone and location require an HTTPS origin and explicit device permission.
- Cleaner journey location is foreground-only in the web app. Mobile browsers may suspend location updates when the screen locks or the browser is backgrounded.
- Reliable background GPS and operating-system push notifications would require a later native mobile app or separately reviewed platform integration.

The first launch should remain the mobile web app: customers can use it immediately without installing software, while a native app can follow only if real booking volume justifies it.
