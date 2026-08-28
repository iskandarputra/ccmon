/**
 * @file App.tsx
 * @brief Root layout — sidebar, titlebar, view switching, status bar.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { lazy, Suspense, useEffect, useRef, useState, type ComponentType } from 'react';
import { useBootstrap, updateSettings } from './bootstrap';
import { useUsageStore, type ViewId } from './store/useUsageStore';
import { TitleBar } from './components/layout/TitleBar';
import { StatusBar } from './components/layout/StatusBar';
import { Sidebar, VIEWS } from './components/layout/Sidebar';
import { ScanOverlay } from './components/overlays/ScanOverlay';
import { CommandPalette } from './components/CommandPalette';
import { EmptyState } from './components/overlays/EmptyState';
import { OverviewView } from './views/OverviewView';
import { ActivityView } from './views/ActivityView';
import { InsightsView } from './views/InsightsView';
import { SessionsView } from './views/SessionsView';
import { BlocksView } from './views/BlocksView';
import { ModelsView } from './views/ModelsView';
import { ProjectsView } from './views/ProjectsView';
import { AccountsView } from './views/AccountsView';
import { AdvisorView } from './views/AdvisorView';
import { LinksView } from './views/LinksView';
import { SettingsView } from './views/SettingsView';

// three.js is heavy — code-split it so the 3d view loads on first visit only
const SpatialView = lazy(() =>
  import('./views/SpatialView').then((m) => ({ default: m.SpatialView })),
);

const VIEW_COMPONENTS: Record<ViewId, ComponentType> = {
  overview: OverviewView,
  activity: ActivityView,
  insights: InsightsView,
  spatial: SpatialView,
  sessions: SessionsView,
  blocks: BlocksView,
  models: ModelsView,
  projects: ProjectsView,
  accounts: AccountsView,
  advisor: AdvisorView,
  links: LinksView,
  settings: SettingsView,
};

/** One delegated mousemove feeds --spot-x/--spot-y to the hovered panel. */
function useSpotlight(): void {
  useEffect(() => {
    let raf = 0;
    const onMove = (e: MouseEvent) => {
      if (raf) return;
      const panel = (e.target as HTMLElement | null)?.closest?.('.panel') as HTMLElement | null;
      if (!panel) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const r = panel.getBoundingClientRect();
        panel.style.setProperty('--spot-x', `${e.clientX - r.left}px`);
        panel.style.setProperty('--spot-y', `${e.clientY - r.top}px`);
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
}

function useViewHotkeys(): void {
  const setView = useUsageStore((s) => s.setView);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < VIEWS.length) setView(VIEWS[idx].id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setView]);
}

function usePrivacyHotkey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        const st = useUsageStore.getState().settings;
        updateSettings({ privacyMode: !st?.privacyMode });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

import { AdvisorDrawer } from './components/advisor/AdvisorDrawer';

function useAdvisorHotkey(onToggle: () => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        onToggle();
      }
    };
    const onOpen = () => onToggle();
    window.addEventListener('keydown', onKey);
    window.addEventListener('open-advisor', onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('open-advisor', onOpen);
    };
  }, [onToggle]);
}

export default function App() {
  useBootstrap();
  useViewHotkeys();
  usePrivacyHotkey();
  useSpotlight();
  const [advisorOpen, setAdvisorOpen] = useState(false);
  useAdvisorHotkey(() => setAdvisorOpen((o) => !o));

  const status = useUsageStore((s) => s.status);
  const hasData = useUsageStore((s) => (s.snapshot?.entryCount ?? 0) > 0);
  const view = useUsageStore((s) => s.view);

  // each view owns its own scroll position — start at the top
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [view]);

  const ViewComponent = VIEW_COMPONENTS[view] || OverviewView;
  // Settings and active dashboard stay visible with low opacity ScanOverlay floating on top during startup/indexing
  const body = (
    <>
      {hasData || view === 'settings' ? (
        <ViewComponent />
      ) : status === 'ready' ? (
        <EmptyState />
      ) : (
        <ViewComponent />
      )}
      {status !== 'ready' && <ScanOverlay />}
    </>
  );

  return (
    <div className="app">
      <TitleBar onToggleAdvisor={() => setAdvisorOpen((o) => !o)} />
      <div className="body">
        <Sidebar />
        <main className="content" ref={contentRef}>
          <Suspense fallback={<div className="view-placeholder">loading 3d…</div>}>
            {/* keyed per view+status so every switch replays the entrance motion */}
            <div className="view-anim" key={`${view}-${status}-${hasData}`}>
              {body}
            </div>
          </Suspense>
        </main>
      </div>
      <StatusBar />
      <div className="grain" aria-hidden="true" />
      <CommandPalette />
      <AdvisorDrawer open={advisorOpen} onClose={() => setAdvisorOpen(false)} />
    </div>
  );
}
