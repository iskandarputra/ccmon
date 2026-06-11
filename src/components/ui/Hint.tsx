/**
 * @file Hint.tsx
 * @brief Collapsed methodology note — a quiet "why?" disclosure.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import './hint.css';
import { useState } from 'react';
import type { ReactNode } from 'react';

interface HintProps {
  /** collapsed button label, e.g. 'why?' or 'how it works' */
  label?: string;
  children: ReactNode;
}

/**
 * Collapsed methodology note (docs/v2-spec.md §6): a quiet disclosure button
 * that expands a short explanation in place. Keeps analysis panels clean
 * while the reasoning stays one click away.
 */
export function Hint({ label = 'why?', children }: HintProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="hint">
      <button
        type="button"
        className="hint-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? 'hide' : label}
      </button>
      {open && <div className="hint-body">{children}</div>}
    </div>
  );
}
