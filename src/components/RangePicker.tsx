/**
 * @file RangePicker.tsx
 * @brief Global analytics time-range control — preset spans + a custom from–to
 *        picker. Lives in the title bar; drives the whole snapshot's history.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useEffect, useRef, useState } from 'react';
import { useUsageStore } from '../store/useUsageStore';
import type { RangePreset } from '../../shared/types';
import './rangepicker.css';

const PRESETS: { preset: RangePreset; label: string }[] = [
  { preset: 'today', label: 'Today' },
  { preset: '7d', label: 'Last 7 days' },
  { preset: '30d', label: 'Last 30 days' },
  { preset: '90d', label: 'Last 90 days' },
  { preset: 'month', label: 'This month' },
  { preset: 'lastMonth', label: 'Last month' },
  { preset: 'all', label: 'All time' },
];

const STATIC_LABEL: Record<RangePreset, string> = {
  today: 'Today',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  month: 'This month',
  lastMonth: 'Last month',
  all: 'All time',
  custom: 'Custom',
};

export function RangePicker() {
  const range = useUsageStore((s) => s.range);
  const setRange = useUsageStore((s) => s.setRange);
  // resolved label from the snapshot (e.g. 'Jun 2026', 'Jun 3 – Jun 18')
  const resolvedLabel = useUsageStore((s) => s.snapshot?.range.label);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range.customStart ?? '');
  const [to, setTo] = useState(range.customEnd ?? '');
  const rootRef = useRef<HTMLDivElement>(null);

  // close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (preset: RangePreset) => {
    setRange({ preset });
    setOpen(false);
  };
  const applyCustom = () => {
    if (!from && !to) return;
    setRange({ preset: 'custom', customStart: from || null, customEnd: to || null });
    setOpen(false);
  };

  const buttonLabel = resolvedLabel || STATIC_LABEL[range.preset];

  return (
    <div className="rp" ref={rootRef}>
      <button
        className={`rp-trigger ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        title="analytics time range"
      >
        <svg
          className="rp-cal"
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="16" y1="2" x2="16" y2="6" />
        </svg>
        <span className="rp-label">{buttonLabel}</span>
        <svg className="rp-chev" width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path
            d="M2 3.5 L5 6.5 L8 3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open && (
        <div className="rp-pop" role="menu">
          <div className="rp-presets">
            {PRESETS.map((p) => (
              <button
                key={p.preset}
                role="menuitemradio"
                aria-checked={range.preset === p.preset}
                className={`rp-item ${range.preset === p.preset ? 'is-active' : ''}`}
                onClick={() => pick(p.preset)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="rp-custom">
            <span className="rp-custom-head">Custom range</span>
            <div className="rp-dates">
              <input
                type="date"
                value={from}
                max={to || undefined}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="from date"
              />
              <span className="rp-dash">→</span>
              <input
                type="date"
                value={to}
                min={from || undefined}
                onChange={(e) => setTo(e.target.value)}
                aria-label="to date"
              />
            </div>
            <button
              className={`rp-apply ${range.preset === 'custom' ? 'is-active' : ''}`}
              onClick={applyCustom}
              disabled={!from && !to}
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
