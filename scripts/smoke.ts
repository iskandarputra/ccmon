/**
 * @file smoke.ts
 * @brief Full-pipeline smoke test against the real local Claude data, without Electron.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Smoke test: runs the full data pipeline (discover → parse → dedupe →
 * price → aggregate) against the real ~/.claude data, without Electron.
 * Validates parsing, pricing, blocks, and the snapshot v2 contract.
 */

import os from 'os';
import path from 'path';
import { detectProjectDirs } from '../electron/services/paths';
import { loadConfig } from '../electron/services/config';
import { createPricingEngine } from '../electron/services/pricing';
import { UsageWatcher } from '../electron/services/watcher';
import { buildSnapshot } from '../electron/services/aggregate';
import { DEFAULTS } from '../electron/services/settings';
import type { Snapshot } from '../shared/types';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const dirs = detectProjectDirs(cfg.claudeDirs || []);
  console.log('source dirs:', dirs);
  if (!dirs.length) {
    console.error('no Claude data directories found');
    process.exit(1);
  }

  const pricing = await createPricingEngine({
    cacheDir: path.join(os.tmpdir(), 'ccmon-smoke'),
    offline: true, // deterministic: bundled snapshots only
    overrides: cfg.pricing || {},
  });
  console.log('pricing  :', JSON.stringify(pricing.meta()));

  const watcher = new UsageWatcher({ dirs, watch: false });
  watcher.on('progress', (p) => {
    if (p.scanned % 200 === 0 || p.scanned === p.total) {
      console.log(`  scanned ${p.scanned}/${p.total} files, ${p.entries} entries`);
    }
  });

  const t0 = Date.now();
  const entries = await watcher.start();
  console.log(`\nindexed ${entries.length} entries in ${Date.now() - t0}ms`);

  const t1 = Date.now();
  const snap = buildSnapshot(entries, {
    now: Date.now(),
    sourceDirs: dirs,
    version: 'smoke',
    pricing,
    settings: { ...DEFAULTS },
    resetTs: watcher.resetTs,
    compactions: watcher.compactions,
  });
  console.log(`aggregated in ${Date.now() - t1}ms\n`);

  const $ = (v: number | null | undefined) => '$' + (v || 0).toFixed(2);
  const tok = (n: number) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : (n / 1e6).toFixed(1) + 'M');

  console.log('totals  :', $(snap.totals.cost), '|', tok(snap.totals.tokens), 'in+out |',
    tok(snap.totals.allTokens), 'all |', snap.totals.sessions, 'sessions');
  console.log('today   :', $(snap.today.cost), '|', snap.today.entries, 'messages |',
    snap.today.sessions, 'sessions');
  console.log('week    :', $(snap.week.cost), '| weekly buckets:', snap.weekly.length,
    '| monthly:', snap.monthly.length);
  console.log('models  :');
  for (const m of snap.models.slice(0, 8)) {
    console.log(`  ${m.model.padEnd(30)} ${$(m.cost).padStart(10)}  ${String(m.entries).padStart(6)} msgs`);
  }
  if (snap.block) {
    const b = snap.block;
    console.log('block   : active,', $(b.cost), '|', tok(b.totalTokens), 'tok |',
      Math.round(b.remainingMs / 60000), 'min left |',
      'burn', b.burn ? `${Math.round(b.burn.tokensPerMin)}/min (${b.burn.level})` : '—', '|',
      'proj', b.projection ? `${tok(b.projection.totalTokens)} ${$(b.projection.totalCost)}` : '—', '|',
      'limit', b.limit ? `${b.limit.status} ${Math.round(b.limit.projectedPct)}%` : '—');
  } else {
    console.log('block   : none active');
  }
  console.log('blocks  :', snap.blocks.length, 'in window (',
    snap.blocks.filter((b) => b.isGap).length, 'gaps )');
  console.log('sessions:', snap.sessions.length, 'tracked |',
    snap.sessions.filter((s) => s.context).length, 'with context gauge');
  console.log('cache   : hit', ((snap.cache.hitRate || 0) * 100).toFixed(1) + '%',
    '| saved', $(snap.cache.savedUSD), '| would-have-cost', $(snap.cache.wouldHaveCostUSD));
  console.log('idle    :', snap.cache.idle.events, 'ttl re-writes |',
    tok(snap.cache.idle.tokens), 'tok |', $(snap.cache.idle.extraUSD), 'extra');
  console.log('what-if :');
  for (const w of snap.whatIf) {
    console.log(`  all on ${w.model.padEnd(30)} ${$(w.totalCost).padStart(10)}  ` +
      `${w.delta <= 0 ? '' : '+'}${$(w.delta)} vs actual`);
  }
  console.log('sidechn :', $(snap.sidechain.cost), 'across',
    snap.sidechain.entries, 'sidechain entries');
  console.log('stops   :', JSON.stringify(snap.stopReasons), '| compactions:', snap.compactions);
  console.log('tools   :', snap.toolUse.invocations, 'invocations |',
    snap.toolUse.turns, 'tool turns');
  for (const t of snap.toolUse.rows.slice(0, 8)) {
    console.log(`  ${t.name.padEnd(30)} ${String(t.invocations).padStart(7)}×  ${$(t.cost).padStart(10)}`);
  }
  console.log('records :', JSON.stringify(snap.records));
  if (snap.block && snap.block.usageLimitResetTs) {
    console.log('quota   : reset at', new Date(snap.block.usageLimitResetTs).toISOString());
  }
  if (snap.unknownModels.length) {
    console.log('WARNING unknown pricing for models:', snap.unknownModels.join(', '));
  }

  // contract sanity
  const keys = [
    'days', 'weekly', 'monthly', 'models', 'projects', 'sessions', 'blocks',
    'cache', 'whatIf', 'sidechain', 'toolUse', 'records', 'hourly', 'hourlyCost',
    'recentEvents',
  ] as const satisfies ReadonlyArray<keyof Snapshot>;
  const missing = keys.filter((k) => snap[k] == null);
  if (missing.length) {
    console.error('\nsmoke FAILED: snapshot missing keys:', missing.join(', '));
    process.exit(1);
  }
  console.log('\nsmoke OK');
}

main().catch((err) => {
  console.error('smoke FAILED:', err);
  process.exit(1);
});
