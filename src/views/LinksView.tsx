/**
 * @file LinksView.tsx
 * @brief Links — official Claude / Anthropic channels and status pages. Each
 *        card opens in the system browser (shell.openExternal via openUrl); the
 *        app itself loads nothing from these hosts.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import './links.css';
import type { ReactNode } from 'react';
import { Panel } from '../components/ui/Panel';

interface LinkDef {
  title: string;
  url: string;
  kind: keyof typeof GLYPHS;
}

interface LinkGroup {
  heading: string;
  links: LinkDef[];
}

const GROUPS: LinkGroup[] = [
  {
    heading: 'follow',
    links: [
      { title: 'Claude on X', url: 'https://x.com/ClaudeAI', kind: 'x' },
      { title: 'ClaudeDevs on X', url: 'https://x.com/ClaudeDevs', kind: 'x' },
      { title: 'Claude on Threads', url: 'https://www.threads.com/@claudeai', kind: 'threads' },
      { title: 'r/claude', url: 'https://www.reddit.com/r/claude/', kind: 'reddit' },
    ],
  },
  {
    heading: 'updates & status',
    links: [
      { title: 'Anthropic News', url: 'https://www.anthropic.com/news', kind: 'news' },
      {
        title: "Claude Code — What's New",
        url: 'https://code.claude.com/docs/en/whats-new',
        kind: 'docs',
      },
      { title: 'Claude Status', url: 'https://status.claude.com/', kind: 'status' },
    ],
  },
];

/* 15px stroke glyphs, currentColor */
const GLYPHS: Record<string, ReactNode> = {
  x: <path d="M4 4l16 16M20 4L4 20" />,
  threads: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 14.5c1 1.5 4.5 1.8 5.2-.6.5-1.8-.7-3.4-2.8-3.4-2 0-3 1.4-2.4 2.8" />
    </>
  ),
  reddit: (
    <>
      <circle cx="12" cy="13" r="7.5" />
      <circle cx="18.5" cy="6.5" r="1.4" />
      <line x1="14" y1="7" x2="17.4" y2="6.6" />
    </>
  ),
  news: (
    <>
      <rect x="3.5" y="5" width="14" height="14" rx="1.5" />
      <path d="M17.5 9H20a1 1 0 0 1 1 1v7.5a1.5 1.5 0 0 1-3 0V9z" />
      <line x1="6.5" y1="9" x2="12" y2="9" />
      <line x1="6.5" y1="13" x2="14.5" y2="13" />
    </>
  ),
  docs: (
    <>
      <path d="M6 3.5h7l5 5V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
      <polyline points="13 3.5 13 9 18 9" />
    </>
  ),
  status: <polyline points="3 12 7 12 10 5 14 19 17 12 21 12" />,
};

function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function LinkCard({ title, url, kind }: LinkDef) {
  return (
    <button type="button" className="lnk-card" onClick={() => window.ccmon?.openUrl(url)}>
      <svg
        className="lnk-glyph"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {GLYPHS[kind]}
      </svg>
      <span className="lnk-text">
        <span className="lnk-title">{title}</span>
        <span className="lnk-host">{host(url)}</span>
      </span>
      <span className="lnk-arrow" aria-hidden="true">
        ↗
      </span>
    </button>
  );
}

export function LinksView() {
  return (
    <div className="grid">
      {GROUPS.map((group) => (
        <div className="g12" key={group.heading}>
          <Panel title={group.heading}>
            <div className="lnk-grid">
              {group.links.map((l) => (
                <LinkCard key={l.url} {...l} />
              ))}
            </div>
          </Panel>
        </div>
      ))}
    </div>
  );
}
