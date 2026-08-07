/**
 * @file CommandPalette.tsx
 * @brief Cmd/Ctrl-K command palette — quick view navigation + common actions.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import './commandpalette.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useUsageStore } from '../store/useUsageStore';
import { VIEWS } from './layout/Sidebar';
import { updateSettings } from '../bootstrap';

interface Command {
  id: string;
  title: string;
  hint?: string;
  run: () => void;
}

/** Subsequence match (chars of `q` appear in order in `text`) — cheap fuzzy. */
function matches(q: string, text: string): boolean {
  if (!q) return true;
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of q.toLowerCase()) {
    i = t.indexOf(ch, i);
    if (i === -1) return false;
    i += 1;
  }
  return true;
}

export function CommandPalette() {
  const setView = useUsageStore((s) => s.setView);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(() => {
    const nav: Command[] = VIEWS.map((v) => ({
      id: `view:${v.id}`,
      title: `Go to ${v.label}`,
      hint: 'view',
      run: () => setView(v.id),
    }));
    const privacy = useUsageStore.getState().settings?.privacyMode;
    const actions: Command[] = [
      {
        id: 'privacy',
        title: privacy
          ? 'Disable Privacy Mode (show dollars)'
          : 'Enable Privacy Mode (hide dollars as $•••)',
        hint: 'privacy',
        run: () => {
          const st = useUsageStore.getState().settings;
          updateSettings({ privacyMode: !st?.privacyMode });
        },
      },
      {
        id: 'rescan',
        title: 'Rescan transcripts',
        hint: 'action',
        run: () => void window.ccmon?.rescan(),
      },
      {
        id: 'limits',
        title: 'Refresh plan limits',
        hint: 'action',
        run: () => void window.ccmon?.refreshLimits(),
      },
      {
        id: 'pricing',
        title: 'Refresh pricing',
        hint: 'action',
        run: () => void window.ccmon?.refreshPricing(),
      },
      {
        id: 'currency',
        title: 'Refresh currency rates',
        hint: 'action',
        run: () => void window.ccmon?.refreshCurrency(),
      },
      {
        id: 'datadir',
        title: 'Open data folder',
        hint: 'action',
        run: () => void window.ccmon?.openDataDir(),
      },
      {
        id: 'csv-days',
        title: 'Export daily CSV',
        hint: 'export',
        run: () => void window.ccmon?.exportCsv('days'),
      },
      {
        id: 'csv-sessions',
        title: 'Export sessions CSV',
        hint: 'export',
        run: () => void window.ccmon?.exportCsv('sessions'),
      },
      {
        id: 'csv-projects',
        title: 'Export projects CSV',
        hint: 'export',
        run: () => void window.ccmon?.exportCsv('projects'),
      },
      {
        id: 'csv-models',
        title: 'Export models CSV',
        hint: 'export',
        run: () => void window.ccmon?.exportCsv('models'),
      },
    ];
    return [...nav, ...actions];
  }, [setView]);

  const filtered = useMemo(
    () => commands.filter((c) => matches(query, c.title)),
    [commands, query],
  );

  // global Cmd/Ctrl-K or custom open event toggles the palette
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onCustomOpen = () => setOpen(true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('open-cmdk', onCustomOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('open-cmdk', onCustomOpen);
    };
  }, []);

  // reset + focus when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

  const choose = (cmd: Command | undefined) => {
    if (!cmd) return;
    cmd.run();
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') return setOpen(false);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(filtered[active]);
    }
  };

  return (
    <div className="cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="cmdk" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmdk-input"
          type="text"
          value={query}
          placeholder="jump to a view or run an action…"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <ul className="cmdk-list">
          {filtered.length === 0 && <li className="cmdk-empty">no matches</li>}
          {filtered.map((c, i) => (
            <li
              key={c.id}
              className={`cmdk-item${i === active ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(c)}
            >
              <span className="cmdk-title">{c.title}</span>
              {c.hint && <span className="cmdk-hint">{c.hint}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
