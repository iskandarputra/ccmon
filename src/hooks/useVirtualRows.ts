/**
 * @file useVirtualRows.ts
 * @brief Minimal fixed-height row virtualization for a bounded scroll container.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useEffect, useRef, useState } from 'react';

export interface VirtualRows {
  /** attach to the scroll container (must have a bounded height + overflow) */
  ref: React.RefObject<HTMLDivElement>;
  /** index of the first row to render (inclusive) */
  start: number;
  /** index just past the last row to render (exclusive) */
  end: number;
  /** spacer height above the rendered window, px */
  padTop: number;
  /** spacer height below the rendered window, px */
  padBottom: number;
}

/**
 * Windowing for a list of `total` fixed-height rows: render only those in (and
 * near) the viewport, padded by spacers so the scrollbar still reflects the
 * full list. Before the container is measured it returns the full range, so the
 * first paint is correct and merely un-trimmed. No dependencies.
 */
export function useVirtualRows(total: number, rowH: number, overscan = 8): VirtualRows {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setViewport(el.clientHeight);
    const onScroll = () => setScrollTop(el.scrollTop);
    measure();
    el.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', onScroll);
      ro.disconnect();
    };
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const span = viewport ? Math.ceil(viewport / rowH) + overscan * 2 : total;
  const end = Math.min(total, start + span);
  return { ref, start, end, padTop: start * rowH, padBottom: Math.max(0, (total - end) * rowH) };
}
