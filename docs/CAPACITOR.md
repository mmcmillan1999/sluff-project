# Capacitor (native iOS/Android shell)

Sluff is wrapped with [Capacitor](https://capacitorjs.com) to ship the existing
React build as a native app. The web app's **bundled assets** run inside the
native WebView and talk to the production backend over the network — we do **not**
point the WebView at a remote URL (Apple rejects website wrappers, guideline 4.2).

## What's already wired (done on Windows, in this repo)
- Capacitor core + CLI + `ios` platform plugin, plus `@capacitor/app`,
  `splash-screen`, `status-bar`, `haptics`, `keyboard` (in `frontend/package.json`).
- `frontend/capacitor.config.json` — `appId: com.playsluff.app`, `appName: Sluff`,
  **`webDir: build`** (matches the Vite output).
- `frontend/src/services/api.js` — pins the backend to production when running
  natively (`Capacitor.isNativePlatform()`), because the WebView's hostname is
  `localhost` and would otherwise hit a non-existent on-device backend.
- `backend/src/server.js` — CORS allowlist includes `capacitor://localhost`,
  `ionic://localhost`, `http://localhost` (the native app origins).
- `frontend/src/utils/nativeInit.js` — hides the splash + sets the status bar
  style on launch (no-ops on web).
- `ErrorBoundary` around the app so a render crash doesn't white-screen the
  WebView (no address bar to reload from).
- Safe-area CSS vars + `viewport-fit=cover` + non-overlay status bar.

## Prerequisites (the macOS part)
Building/running/submitting **iOS requires macOS + Xcode** — there is no Windows
path. You also need an **Apple Developer account ($99/yr)**. Options if you don't
have a Mac on your desk: a cloud Mac (e.g. MacInCloud) or CI with macOS runners
(GitHub Actions can build/sign and upload to TestFlight).

## Build steps (run on a Mac)
```bash
cd frontend
npm install                 # installs Capacitor + plugins
npm run build               # produces frontend/build (the webDir)
npx cap add ios             # scaffolds the Xcode project (runs CocoaPods)
npx cap sync                # copies web assets + native deps into the project
npx cap open ios            # opens Xcode
```
In Xcode: set the Signing team, pick a device/simulator, and Run. After any web
change, re-run `npm run build && npx cap sync`.

## Done since this doc was written (July 2026)
- **In-app account deletion** (Apple 5.1.1(v)) — Lobby menu → Account → Account
  Settings. Requires the player to retype their username and their password.
  Refused while a staked game is in progress, or for the last admin account.
  See `backend/src/data/accountDeletion.js`.
- **Username validation** — shared validator on both registration and rename
  (`backend/src/data/accountIdentity.js`): 3–20 chars, letters/digits with single
  internal space/hyphen/underscore, a reserved-name list, and a case-insensitive
  unique index so nobody can shadow another player (or a bot) by capitalisation.
  This is only *part* of Apple 1.2 — see the chat-moderation item below.
- 4-player is shipped (Quick Play offers a 4-seat start), so that decision is closed.

## Still TODO before submission (tracked separately)
- App icons: the largest asset today is 512×512; the App Store needs **1024×1024**,
  and Android needs adaptive icons. No `frontend/resources/` yet for
  `@capacitor/assets` to generate from. Plus splash images.
- **Chat moderation**: profanity filter + report + block (Apple 1.2). Lobby chat
  still inserts messages verbatim with no filter, no report, and no block, and
  there is no ban tooling in `api/admin.js` despite the Terms promising suspension.
- **Age rating vs. simulated gambling.** Players stake tokens and the winner takes
  the pot. The Terms say 13+ (`TermsOfService.js`, with an open TODO); a rating
  board will likely want 17+/18+. Decide before filling in the questionnaire.
- Privacy policy URL + App Privacy "nutrition label". `/privacy` and `/terms`
  resolve for a logged-out visitor but are unreachable once signed in — add a
  footer link, and confirm the URL in a private window before submitting.
- Confirm `support@playsluff.com` actually receives mail (`PrivacyPolicy.js` TODO);
  reviewers do test it. Both legal pages are still marked lawyer-unreviewed.
- **Android is not started**: `@capacitor/android` isn't installed and there's no
  `android/` directory. Buildable from Windows, unlike iOS.
- On-device **safe-area** tuning (bottom hand vs. home indicator).
- Always-on backend tier. A GitHub Actions cron pings `/health` every 10 minutes
  to dodge Render's idle spin-down; a Starter instance is the real fix.
- Token monetization stays out (IAP if ever sold). Note that selling tokens would
  also flip the "no payment path" answer the store classification rests on.
- No crash reporting anywhere — only a React `ErrorBoundary`.
