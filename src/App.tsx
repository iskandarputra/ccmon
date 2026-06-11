/**
 * @file App.tsx
 * @brief Root layout — sidebar, titlebar, view switching, status bar.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { lazy, Suspense, useEffect, useRef, type ComponentType } from 'react';
import { useBootstrap } from './bootstrap';
import { useUsageStore, type ViewId } from './store/useUsageStore';
import { TitleBar } from './components/layout/TitleBar';
import { StatusBar } from './components/layout/StatusBar';
import { Sidebar, VIEWS } from './components/layout/Sidebar';
import { ScanOverlay } from './components/overlays/ScanOverlay';
import { EmptyState } from './components/overlays/EmptyState';
import { OverviewView } from './views/OverviewView';
import { ActivityView } from './views/ActivityView';
import { InsightsView } from './views/InsightsView';
import { SessionsView } from './views/SessionsView';
import { BlocksView } from './views/BlocksView';
import { ModelsView } from './views/ModelsView';
import { ProjectsView } from './views/ProjectsView';
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

export default function App() {
  useBootstrap();
  useViewHotkeys();
  useSpotlight();
  const status = useUsageStore((s) => s.status);
  const hasData = useUsageStore((s) => (s.snapshot?.entryCount ?? 0) > 0);
  const view = useUsageStore((s) => s.view);

  // each view owns its own scroll position — start at the top
  const contentRef = useRef<HTMLElement>(null);
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [view]);

  const ViewComponent = VIEW_COMPONENTS[view] || OverviewView;
  // Settings stays reachable even while scanning / with no data.
  const body =
    view === 'settings' ? (
      <ViewComponent />
    ) : status !== 'ready' ? (
      <ScanOverlay />
    ) : hasData ? (
      <ViewComponent />
    ) : (
      <EmptyState />
    );

  return (
    <div className="app">
      <TitleBar />
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
    </div>
  );
}
