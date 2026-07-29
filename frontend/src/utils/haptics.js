// frontend/src/utils/haptics.js
// Haptic taps for beats the player must not miss. The web build uses the
// Vibration API; iOS Safari has never shipped it, so the web path silently
// no-ops there. The Capacitor shell exposes window.Capacitor, and we route
// through its native engine so iPhone builds still buzz. Checking the global
// instead of importing @capacitor/core keeps this usable from any component
// without pulling the native bridge into the web bundle's import graph.

const isNativeShell = () => (
    typeof window !== 'undefined' && Boolean(window.Capacitor?.isNativePlatform?.())
);

const NATIVE_TAP_GAP_MS = 120;

/**
 * @param {object} options
 * @param {number[]} options.pattern  Vibration API pattern, in ms.
 * @param {'Light'|'Medium'|'Heavy'} options.nativeStyle
 * @param {number} options.nativeTaps How many impacts to fire on native.
 */
export const buzz = ({ pattern = [20], nativeStyle = 'Medium', nativeTaps = 1 } = {}) => {
    if (isNativeShell()) {
        import('@capacitor/haptics').then(({ Haptics, ImpactStyle }) => {
            const style = ImpactStyle[nativeStyle] || ImpactStyle.Medium;
            for (let tap = 0; tap < nativeTaps; tap += 1) {
                setTimeout(() => { Haptics.impact({ style }).catch(() => {}); }, tap * NATIVE_TAP_GAP_MS);
            }
        }).catch(() => {});
        return;
    }
    try {
        navigator.vibrate?.(pattern);
    } catch {
        // Haptics are a nicety; a browser that refuses must never break play.
    }
};

export default buzz;
