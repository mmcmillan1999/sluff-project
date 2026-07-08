// Native (Capacitor) startup wiring. No-ops on the web build, so it's safe to
// call unconditionally from the app entry point.
import { Capacitor } from '@capacitor/core';

export async function initNative() {
    if (!Capacitor.isNativePlatform()) return;

    try {
        const { StatusBar, Style } = await import('@capacitor/status-bar');
        // Light content (white icons/text) over the dark app background.
        await StatusBar.setStyle({ style: Style.Light }).catch(() => {});
    } catch { /* status bar plugin unavailable */ }

    try {
        const { SplashScreen } = await import('@capacitor/splash-screen');
        // Hide as soon as the JS app is up (config also auto-hides as a backstop).
        await SplashScreen.hide().catch(() => {});
    } catch { /* splash plugin unavailable */ }

    try {
        const { App } = await import('@capacitor/app');
        const { extractInviteTableId } = await import('./tableInvites.js');
        // Invite deep links (https://playsluff.com/join/<tableId>). The stashed
        // global covers cold starts where the link arrives before React mounts;
        // the window event covers warm opens while the app is already running.
        const handleInviteUrl = (url) => {
            const tableId = extractInviteTableId(url);
            if (!tableId) return;
            window.__sluffInviteTableId = tableId;
            window.dispatchEvent(new CustomEvent('sluff:invite', { detail: { tableId } }));
        };
        App.addListener('appUrlOpen', ({ url }) => handleInviteUrl(url));
        const launch = await App.getLaunchUrl().catch(() => null);
        if (launch?.url) handleInviteUrl(launch.url);
    } catch { /* app plugin unavailable */ }
}
