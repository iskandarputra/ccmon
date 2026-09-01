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
  accounts: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  advisor: (
    <>
      <path d="M4 5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />
      <circle cx="9" cy="10.5" r="1" />
      <circle cx="12" cy="10.5" r="1" />
      <circle cx="15" cy="10.5" r="1" />
    </>
  ),
  links: (
    <>
      <path d="M9.5 13.5l5-5" />
      <path d="M7.5 11l-2 2a3.2 3.2 0 0 0 4.5 4.5l2-2" />
      <path d="M16.5 13l2-2a3.2 3.2 0 0 0-4.5-4.5l-2 2" />
    </>
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
  badge?: string;
}

export const CORE_VIEWS: ViewDef[] = [
  { id: 'overview', label: 'pulse' },
  { id: 'insights', label: 'analytics' },
  { id: 'projects', label: 'projects' },
  { id: 'accounts', label: 'accounts' },
];

export const VIEWS: ViewDef[] = [
  ...CORE_VIEWS,
  { id: 'spatial', label: '3d canvas' },
  { id: 'advisor', label: 'ai advisor' },
  { id: 'sessions', label: 'sessions' },
  { id: 'blocks', label: 'blocks' },
  { id: 'models', label: 'models' },
  { id: 'links', label: 'resources' },
  { id: 'settings', label: 'settings' },
];

export interface NavGroup {
  name: string;
  items: ViewDef[];
}

/**
 * The key that selects VIEWS[i], and the badge NavItem prints for it. ONE
 * alphabet, exported, because the badge and `App.tsx#useViewHotkeys` used to
 * derive their own: the badge printed '0'/'-' for the last two views while the
 * handler did `Number(e.key) - 1`, which is -1 for '0' and NaN for '-'. Both
 * badges promised a key that did nothing. Anything reading a view hotkey must
 * come through here.
 */
export const VIEW_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='] as const;

/** The key for a position in VIEWS, or '' past the end of the alphabet. */
export const hotkeyFor = (index: number): string => VIEW_KEYS[index] ?? '';

/** VIEWS index for a pressed key, or -1 when the key is not a view hotkey. */
export const viewIndexForKey = (key: string): number =>
  (VIEW_KEYS as readonly string[]).indexOf(key);

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
      title={hotkeyFor(index) ? `${view.label} (${hotkeyFor(index)})` : view.label}
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
      <span className="nav-key">{hotkeyFor(index)}</span>
    </button>
  );
}

/**
 * Position of a view in VIEWS — which is exactly the hotkey `useViewHotkeys`
 * binds it to. The secondary groups below render views out of VIEWS order, so
 * they MUST look their index up rather than count their own children: the
 * hardcoded 5/6/11 this replaces printed 6/7/= on keys that were really 5/6/-.
 */
const viewIndex = (id: ViewId): number => VIEWS.findIndex((v) => v.id === id);

export function Sidebar() {
  const view = useUsageStore((s) => s.view);
  const setView = useUsageStore((s) => s.setView);

  const groups: NavGroup[] = [{ name: 'Workspace', items: CORE_VIEWS }];

  return (
    <nav className="sidebar">
      {groups.map((group) => (
        <div key={group.name} className="nav-group">
          <div className="nav-group-title">{group.name}</div>
          {group.items.map((v, i) => (
            <NavItem key={v.id} view={v} index={i} active={view === v.id} onSelect={setView} />
          ))}
        </div>
      ))}
      <div className="nav-spacer" />
      <div className="nav-group nav-group-secondary">
        <div className="nav-group-title">Tools</div>
        <NavItem
          view={{ id: 'spatial', label: '3d canvas' }}
          index={viewIndex('spatial')}
          active={view === 'spatial'}
          onSelect={setView}
        />
        <NavItem
          view={{ id: 'advisor', label: 'ai advisor' }}
          index={viewIndex('advisor')}
          active={view === 'advisor'}
          onSelect={setView}
        />
      </div>
      <div className="nav-group nav-group-system">
        <NavItem
          view={{ id: 'settings', label: 'settings' }}
          index={viewIndex('settings')}
          active={view === 'settings'}
          onSelect={setView}
        />
      </div>
    </nav>
  );
}
