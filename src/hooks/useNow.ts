/**
 * @file useNow.ts
 * @brief Ticking clock hook for countdowns and relative times.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useEffect, useState } from 'react';

/** Ticking clock for countdowns / relative times. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
