import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export const usePrefersReducedMotion = () => {
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => (
        typeof window !== 'undefined' && typeof window.matchMedia === 'function'
            ? window.matchMedia(QUERY).matches
            : false
    ));

    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return undefined;
        const mediaQuery = window.matchMedia(QUERY);
        const updatePreference = (event) => setPrefersReducedMotion(event.matches);
        setPrefersReducedMotion(mediaQuery.matches);
        if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', updatePreference);
        else mediaQuery.addListener?.(updatePreference);
        return () => {
            if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', updatePreference);
            else mediaQuery.removeListener?.(updatePreference);
        };
    }, []);

    return prefersReducedMotion;
};

export default usePrefersReducedMotion;
