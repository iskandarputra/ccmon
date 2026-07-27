/**
 * @file bootstrap.ts
 * @brief Wires the preload IPC bridge into the store; applies theme and display currency.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useEffect } from 'react';
import { useUsageStore } from './store/useUsageStore';
import { applyTheme } from './theme/applyTheme';
import { DEFAULT_THEME_ID } from './theme/themes';
import { configureCurrency } from './lib/format';
import type { AppSettings } from '../shared/types';

/**
 * Point the money formatters at settings.currency using the latest rates
 * (docs/v2-spec.md §5). On change, re-emit the snapshot and feed (cloned) so
 * every subscriber re-renders with the new formatting — components call
 * fmtUSD directly and have no other way to notice. Unknown code or missing
 * rate falls back to USD.
 */
function applyCurrency(): void {
  const st = useUsageStore.getState();
  const code = st.settings?.currency || 'USD';
  const rate = code === 'USD' ? 1 : st.currency?.rates?.[code];
  const changed = configureCurrency(rate ? code : 'USD', rate || 1);
  if (changed) {
    useUsageStore.setState({
      snapshot: st.snapshot ? { ...st.snapshot } : null,
      feed: st.feed.slice(),
    });
  }
}

/** Wire the preload IPC bridge into the store. Mount once from <App/>. */
export function useBootstrap(): void {
  useEffect(() => {
    const api = window.ccmon;
    if (!api) {
      applyTheme(DEFAULT_THEME_ID);
      useUsageStore.setState({ status: 'error' });
      return undefined;
    }

    let alive = true;
    void api.getState().then((s) => {
      if (!alive) return;
      useUsageStore.setState({
        version: s.version,
        sourceDirs: s.sourceDirs,
        allSourceDirs: s.allSourceDirs || s.sourceDirs,
        progress: s.progress,
        settings: s.settings || null,
        pricingMeta: s.pricingMeta || null,
        accounts: s.accounts || {},
        limits: s.limits || {},
        currency: s.currency || null,
        deepseek: s.deepseek || null,
        deepseekAuth: s.deepseekAuth || null,
      });
      applyTheme(s.settings?.theme || DEFAULT_THEME_ID);
      applyCurrency();
      if (s.snapshot) useUsageStore.getState().setSnapshot(s.snapshot);
      else useUsageStore.setState({ status: s.status === 'error' ? 'error' : 'scanning' });
    });

    const unsubs = [
      api.onSnapshot((snap) => useUsageStore.getState().setSnapshot(snap)),
      api.onProgress((p) => useUsageStore.getState().setProgress(p)),
      api.onEvents((events) => useUsageStore.getState().pushEvents(events)),
      api.onReset(() => useUsageStore.getState().reset()),
      api.onSettings((settings) => {
        useUsageStore.getState().setSettings(settings);
        applyTheme(settings?.theme || DEFAULT_THEME_ID);
        applyCurrency();
      }),
      api.onPricingMeta?.((meta) => useUsageStore.setState({ pricingMeta: meta })),
      api.onLimits?.((limits) => useUsageStore.getState().setLimits(limits)),
      api.onCurrency?.((rates) => {
        useUsageStore.setState({ currency: rates || null });
        applyCurrency();
      }),
      api.onDeepseek?.((result) => useUsageStore.setState({ deepseek: result || null })),
      api.onDeepseekAuth?.((auth) => useUsageStore.setState({ deepseekAuth: auth || null })),
      api.onAccounts?.((p) =>
        useUsageStore.setState({
          sourceDirs: p.sourceDirs,
          allSourceDirs: p.allSourceDirs,
          accounts: p.accounts,
        }),
      ),
    ].filter(Boolean);

    return () => {
      alive = false;
      unsubs.forEach((u) => u());
    };
  }, []);
}

/** Patch settings in main; the change echoes back via onSettings. */
export function updateSettings(partial: Partial<AppSettings>) {
  return window.ccmon?.setSettings(partial);
}

/** Refresh the store's account list after main re-detects config roots (new/renamed account dir). */
export async function refreshAccounts(): Promise<void> {
  const s = await window.ccmon?.getState();
  if (s) {
    useUsageStore.setState({
      sourceDirs: s.sourceDirs,
      allSourceDirs: s.allSourceDirs || s.sourceDirs,
      accounts: s.accounts,
      limits: s.limits,
    });
  }
}
