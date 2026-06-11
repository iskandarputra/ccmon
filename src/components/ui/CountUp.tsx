/**
 * @file CountUp.tsx
 * @brief Animated numeric value (reduced-motion aware).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useEffect, useRef, useState } from 'react';

interface CountUpProps {
  value: number;
  format: (v: number) => string;
  durationMs?: number;
}

/**
 * Animated numeral: eases from the previous value to the new one whenever
 * `value` changes (and counts in from 0 on mount, pairing with the panel
 * entrance). Snaps instantly under prefers-reduced-motion.
 */
export function CountUp({ value, format, durationMs = 700 }: CountUpProps) {
  const [display, setDisplay] = useState(0);
  const displayRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      displayRef.current = value;
      setDisplay(value);
      return undefined;
    }
    const from = displayRef.current;
    if (from === value) return undefined;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = from + (value - from) * eased;
      displayRef.current = v;
      setDisplay(v);
      if (p < 1) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, durationMs]);

  return <>{format(display)}</>;
}
