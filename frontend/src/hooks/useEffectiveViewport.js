// frontend/src/hooks/useEffectiveViewport.js
import { useEffect, useState } from 'react';

// Returns effective viewport dimensions, dpr, and a rough zoom estimate.
export function useEffectiveViewport() {
  const calc = () => {
    const vw = Math.round(window.innerWidth);
    const vh = Math.round(window.innerHeight);
    const dpr = window.devicePixelRatio || 1;
    // Approximate zoom: physical CSS px relative to screen width in CSS px
    // Note: This is heuristic and varies by OS/display scaling.
  const sw = (typeof window !== 'undefined' && window.screen && window.screen.width) ? window.screen.width : vw;
  const zoom = Math.round((sw * dpr / vw) * 100) / 100;
    return { vw, vh, dpr, zoom };
  };

  const [state, setState] = useState(calc);

  useEffect(() => {
    const handler = () => setState(calc());
    window.addEventListener('resize', handler);
    window.addEventListener('orientationchange', handler);
    return () => {
      window.removeEventListener('resize', handler);
      window.removeEventListener('orientationchange', handler);
    };
  }, []);

  return state;
}
