/**
 * @file Panel.tsx
 * @brief Titled panel shell used by every view.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import type { CSSProperties, ReactNode } from 'react';

interface PanelProps {
  title?: ReactNode;
  right?: ReactNode;
  className?: string;
  /** inline style — used to carry per-instance theme vars (e.g. --acc) */
  style?: CSSProperties;
  children?: ReactNode;
}

export function Panel({ title, right, className = '', style, children }: PanelProps) {
  return (
    <section className={`panel ${className}`} style={style}>
      {(title || right) && (
        <header className="panel-head">
          <h3>{title}</h3>
          {right}
        </header>
      )}
      <div className="panel-body">{children}</div>
    </section>
  );
}
