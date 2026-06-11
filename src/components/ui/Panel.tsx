/**
 * @file Panel.tsx
 * @brief Titled panel shell used by every view.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import type { ReactNode } from 'react';

interface PanelProps {
  title?: ReactNode;
  right?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function Panel({ title, right, className = '', children }: PanelProps) {
  return (
    <section className={`panel ${className}`}>
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
