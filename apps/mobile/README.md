# Baha Ready 3D — Android (Capacitor)

Thin native shell around the deployed web app (`server.url` = `PRODUCTION_URL`), so gameplay,
auth and server-side scoring are identical on web and Android.

## Build a signed release (AAB)
1. Install Android Studio (SDK + JDK 21) and set `ANDROID_HOME`.
2. `pnpm --filter @baha/mobile build:android` — signs with `apps/mobile/keystore/release.keystore`
   using `ANDROID_KEYSTORE_*` from the root `.env.local`.
3. Upload `android/app/build/outputs/bundle/release/app-release.aab` to Play Console.

**Back up the keystore + password** (password manager / offline). Losing it means you can never
update the Play listing. It is git-ignored and must never be committed.

## Deep links
- Verified App Links: `https://baha-ready-3d.vercel.app/*` (served `/.well-known/assetlinks.json`
  with the release key's SHA-256). If Play App Signing re-signs, add Play's SHA-256 there too.
- Custom scheme: `bahaready://join/ABC123`, `bahaready://play/<level>`.

## Native push (optional)
Needs a Firebase project: put `google-services.json` in `android/app/` (git-ignored) and set
`FCM_*` secrets. Until then Android users get in-app + email notifications.
