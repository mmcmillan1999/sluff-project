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

## Still TODO before submission (tracked separately)
- App icons (1024×1024) + splash images.
- In-app **account deletion** (Apple 5.1.1(v)).
- **Chat moderation**: profanity filter + report + block (Apple 1.2).
- Privacy policy URL + App Privacy "nutrition label".
- On-device **safe-area** tuning (bottom hand vs. home indicator).
- Always-on backend tier (Render free tier cold-starts).
- Decide 4-player (fix vs. hide) and token monetization (IAP if ever sold).
