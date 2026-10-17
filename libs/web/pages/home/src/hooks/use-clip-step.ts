import { useEffect, useState, useSyncExternalStore } from 'react';

import { REDUCED_MOTION_QUERY } from './reduced-motion-query';

const CLIP_STEP_MS = 1100;

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function readReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function readServerReducedMotion() {
  return false;
}

/**
 * Drives a looping clip. Returns the current step, advancing once per interval
 * while `playing` is true. Under prefers-reduced-motion the clip holds its final
 * step, so the user sees the finished state rather than a moving one.
 */
export function useClipStep(steps: number, playing: boolean): number {
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    readReducedMotion,
    readServerReducedMotion,
  );
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!playing || reduced) return;
    const id = window.setInterval(
      () => setStep((current) => (current + 1) % steps),
      CLIP_STEP_MS,
    );
    return () => window.clearInterval(id);
  }, [playing, reduced, steps]);

  return reduced ? steps - 1 : step;
}
