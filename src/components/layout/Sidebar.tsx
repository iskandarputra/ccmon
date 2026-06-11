/**
 * @file Sidebar.tsx
 * @brief View navigation rail.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import type { ReactNode } from 'react';
import { useUsageStore, type ViewId } from '../../store/useUsageStore';

/* 15px stroke icons, currentColor — crisper than unicode glyphs */
const ICONS: Record<ViewId, ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </>
  ),
  activity: <polyline points="2 12 6.5 12 9.5 5 14.5 19 17.5 12 22 12" />,
  insights: (
    <>
      <polyline points="3 17 9 11 13 15 21 7" />
      <polyline points="15 7 21 7 21 13" />
    </>
  ),
  spatial: (
    <>
      <path d="M12 2.5l8 4.6v9.8l-8 4.6-8-4.6V7.1z" />
      <polyline points="4 7.1 12 11.7 20 7.1" />
      <line x1="12" y1="11.7" x2="12" y2="21.5" />
    </>
  ),
  sessions: (
    <>
      <line x1="4" y1="6" x2="20" y2="6" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="18" x2="14" y2="18" />
    </>
  ),
  blocks: (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 7 12 12 15.5 14" />
    </>
  ),
  models: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 9 9h-9z" />
    </>
  ),
  projects: (
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19 12a7 7 0 0 0-.14-1.4l2.1-1.62-2-3.46-2.48 1a7 7 0 0 0-2.42-1.4L13.7 2.5h-3.4l-.36 2.62a7 7 0 0 0-2.42 1.4l-2.48-1-2 3.46 2.1 1.62a7 7 0 0 0 0 2.8l-2.1 1.62 2 3.46 2.48-1a7 7 0 0 0 2.42 1.4l.36 2.62h3.4l.36-2.62a7 7 0 0 0 2.42-1.4l2.48 1 2-3.46-2.1-1.62A7 7 0 0 0 19 12z" />
    </>
  ),
};

export interface ViewDef {
  id: ViewId;
  label: string;
}

export const VIEWS: ViewDef[] = [
  { id: 'overview', label: 'overview' },
  { id: 'activity', label: 'activity' },
  { id: 'insights', label: 'insights' },
  { id: 'spatial', label: '3d' },
  { id: 'sessions', label: 'sessions' },
  { id: 'blocks', label: 'blocks' },
  { id: 'models', label: 'models' },
  { id: 'projects', label: 'projects' },
  { id: 'settings', label: 'settings' },
];

interface NavItemProps {
  view: ViewDef;
  index: number;
  active: boolean;
  onSelect: (id: ViewId) => void;
}

function NavItem({ view, index, active, onSelect }: NavItemProps) {
  return (
    <button
      className={`nav-item ${active ? 'is-active' : ''}`}
      onClick={() => onSelect(view.id)}
      title={`${view.label} (${index + 1})`}
    >
      <svg
        className="nav-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {ICONS[view.id]}
      </svg>
      <span className="nav-label">{view.label}</span>
      <span className="nav-key">{index + 1}</span>
    </button>
  );
}

export function Sidebar() {
  const view = useUsageStore((s) => s.view);
  const setView = useUsageStore((s) => s.setView);

  const main = VIEWS.slice(0, -1);
  const settings = VIEWS[VIEWS.length - 1];

  return (
    <nav className="sidebar">
      {main.map((v, i) => (
        <NavItem key={v.id} view={v} index={i} active={view === v.id} onSelect={setView} />
      ))}
      <div className="nav-spacer" />
      <NavItem
        view={settings}
        index={VIEWS.length - 1}
        active={view === settings.id}
        onSelect={setView}
      />
    </nav>
  );
}
