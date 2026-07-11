import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTOR = [
    'button:not(:disabled)',
    '[href]',
    'input:not(:disabled)',
    'select:not(:disabled)',
    'textarea:not(:disabled)',
    '[tabindex]:not([tabindex="-1"])'
].join(',');

export const useModalFocus = (active, initialSelector = FOCUSABLE_SELECTOR) => {
    const containerRef = useRef(null);

    useEffect(() => {
        if (!active || !containerRef.current) return undefined;
        const container = containerRef.current;
        const previouslyFocused = document.activeElement;
        const initialTarget = container.querySelector(initialSelector)
            || container.querySelector(FOCUSABLE_SELECTOR)
            || container;
        initialTarget.focus({ preventScroll: true });

        const handleKeyDown = (event) => {
            if (event.key !== 'Tab') return;
            const focusable = [...container.querySelectorAll(FOCUSABLE_SELECTOR)]
                .filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true');
            if (focusable.length === 0) {
                event.preventDefault();
                container.focus({ preventScroll: true });
                return;
            }

            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (!container.contains(document.activeElement)) {
                event.preventDefault();
                first.focus({ preventScroll: true });
            } else if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus({ preventScroll: true });
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus({ preventScroll: true });
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('keydown', handleKeyDown);
            if (previouslyFocused instanceof HTMLElement && previouslyFocused.isConnected) {
                previouslyFocused.focus({ preventScroll: true });
            }
        };
    }, [active, initialSelector]);

    return containerRef;
};

export default useModalFocus;
