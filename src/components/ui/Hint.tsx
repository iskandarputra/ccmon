/**
 * @file Hint.tsx
 * @brief Collapsed methodology note — a quiet "why?" disclosure.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import './hint.css';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';

interface HintProps {
  /** collapsed button label, e.g. 'why?' or 'how it works' */
  label?: string;
  children: ReactNode;
}

/**
 * Collapsed methodology note (docs/v2-spec.md §6): a quiet disclosure button
 * that expands a short explanation as a popup. Keeps analysis panels clean
 * while the reasoning stays one click away.
 */
export function Hint({ label = 'why?', children }: HintProps) {
  const [open, setOpen] = useState(false);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <>
      <div className="hint">
        <button
          type="button"
          className="hint-btn"
          onClick={() => setOpen(true)}
          aria-expanded={open}
        >
          {label}
        </button>
      </div>

      {open &&
        createPortal(
          <div className="hint-overlay" onClick={() => setOpen(false)}>
            <div className="hint-popup panel" onClick={(e) => e.stopPropagation()}>
              <div className="hint-popup-header">
                <h3 className="hint-popup-title">{label}</h3>
                <button
                  type="button"
                  className="hint-close-btn"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                >
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 12 12"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M9 3L3 9M3 3L9 9"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
              <div className="hint-popup-body">{children}</div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
