import { useState, useEffect } from 'react';

/** Hook: detects prefers-reduced-motion and returns boolean */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  return reduced;
}

/** Returns duration=0 if reduced, else the given ms */
export function motionDuration(ms: number, reduced: boolean): number {
  return reduced ? 0 : ms;
}
