/**
 * @file ConfirmDialog.tsx
 * @brief Generic controlled confirm modal for destructive or notable actions.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import './confirmdialog.css';
import { useEffect, useRef, type ReactNode } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** styles the confirm button as destructive (--rose) instead of --amber */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Controlled confirm/cancel overlay — mirrors CommandPalette's own-CSS, self-contained pattern. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'confirm',
  cancelLabel = 'cancel',
  danger,
  busy,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) requestAnimationFrame(() => confirmRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="cfd-overlay" onClick={onCancel}>
      <div
        className="cfd"
        role="alertdialog"
        aria-modal
        aria-labelledby="cfd-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="cfd-title" className="cfd-title">
          {title}
        </div>
        <div className="cfd-body">{body}</div>
        <div className="cfd-actions">
          <button type="button" className="cfd-cancel" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`cfd-confirm${danger ? ' is-danger' : ''}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
