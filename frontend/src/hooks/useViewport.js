import { useEffect, useState } from 'react';

export function useViewport() {
  const get = () => ({
    width: window.innerWidth,
    height: window.innerHeight,
    orientation: window.matchMedia('(orientation: portrait)').matches ? 'portrait' : 'landscape',
  });

  const [viewport, setViewport] = useState(get());

  useEffect(() => {
    const onResize = () => setViewport(get());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  return viewport;
}
