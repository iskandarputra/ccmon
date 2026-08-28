/**
 * @file aggregate.ts
 * @brief Snapshot v2 reducer — one pass over usage entries into every rollup the UI renders.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { computeBlocks } from './blocks';
import { costForMode, costWith, type PricingEngine } from './pricing';
import { localDateKey } from './parser';
import { resolveProjectRoot } from './paths';
import { dayKeyFor, zonedParts, type Zone } from '../../shared/daykey';
import { dayKeyInRange, isBoundedRange } from '../../shared/range';
import type { ResolvedRange } from '../../shared/types';
import type {
  AccountSpendMap,
  AppSettings,
  CompactMarker,
  CostMode,
  CostReconciliation,
  DayBreakdown,
  DayContributor,
  DayRow,
  FeedEvent,
  ModelRow,
  MonthlyRow,
  ProjectRow,
  SessionContext,
  SessionRow,
  Snapshot,
  RateRow,
  StartOfWeek,
  SumRow,
  ToolResultByDay,
  UsageEntry,
  WeeklyRow,
  WhatIfRow,
  ArchLayerKey,
  FileHotspot,
  KnowledgeGraphData,
  LayerSpend,
  ModuleSpend,
} from '../../shared/types';

const DAY_MS = 86400000;
const DAYS_WINDOW = 35; //      default daily series length (zero-filled) when unbounded
const MAX_RANGE_DAYS = 200; //  cap the daily series for long custom ranges (weekly/monthly carry the rest)
const PROJECT_DAYS = 14; //     per-project sparkline length
const WEEKLY_BUCKETS = 12;
const MONTHLY_BUCKETS = 12;
const HEAT_DAYS = 30; //        activity-rhythm window
const FEED_SEED = 15; //        recent events bundled into the snapshot
const SESSION_LIMIT = 500; // sessions view virtualizes, so it can hold many more
const PROJECT_LIMIT = 40;
const CONTEXT_WINDOW_MS = 48 * 3600 * 1000; // context gauge only for live-ish sessions
const TTL_5M_MS = 5 * 60_000; //  5-minute cache tier — idle past this re-writes w5m
const TTL_1H_MS = 60 * 60_000; // 1-hour cache tier — idle past this re-writes w1h
const WHATIF_CANDIDATES = 6; // top models eligible for the re-cost counterfactual
const TOOL_LIMIT = 20; //      tool rows bundled into the snapshot
const TOOL_DAILY_LIMIT = 8; //  tool ridges in the 3d daily split

/**
 * Ascending day keys ending on `zone`'s today; noon-anchored to dodge DST edges.
 *
 * Only the FIRST key needs the zone (which day is "today"); walking backwards is
 * pure calendar arithmetic on the key, where the system zone cancels out.
 */
function dayKeysBack(n: number, now: number, zone: Zone = null): string[] {
  const d = dateAtNoon(dayKeyFor(now, zone));
  const keys: string[] = [];
  for (let i = 0; i < n; i++) {
    keys.unshift(localDateKey(d.getTime()));
    d.setDate(d.getDate() - 1);
  }
  return keys;
}

/** Noon-anchored Date for a 'YYYY-MM-DD' key (safe for day arithmetic). */
function dateAtNoon(dateKey: string): Date {
  return new Date(`${dateKey}T12:00:00`);
}

/**
 * Ascending local day keys for the resolved range's daily series. An unbounded
 * end means "today"; an unbounded start falls back to the default
 * {@link DAYS_WINDOW} ending at that end (so 'all time' keeps the pre-range
 * 35-day chart). Long spans are capped to {@link MAX_RANGE_DAYS}, anchored at
 * the end — weekly/monthly rollups carry the longer history.
 */
function dayKeysForRange(range: ResolvedRange | null, now: number, zone: Zone = null): string[] {
  if (!range || !isBoundedRange(range)) return dayKeysBack(DAYS_WINDOW, now, zone);
  const end = range.endKey ? dateAtNoon(range.endKey) : dateAtNoon(dayKeyFor(now, zone));
  const start = range.startKey
    ? dateAtNoon(range.startKey)
    : (() => {
        const d = new Date(end);
        d.setDate(d.getDate() - (DAYS_WINDOW - 1));
        return d;
      })();
  const keys: string[] = [];
  const cur = new Date(end);
  while (cur.getTime() >= start.getTime() && keys.length < MAX_RANGE_DAYS) {
    keys.unshift(localDateKey(cur.getTime()));
    cur.setDate(cur.getDate() - 1);
  }
  return keys.length ? keys : [localDateKey(end.getTime())];
}

/** 'YYYY-MM-DD' of the week containing dateKey, per startOfWeek setting. */
function weekStartKey(dateKey: string, startOfWeek: StartOfWeek): string {
  const d = dateAtNoon(dateKey);
  const back = startOfWeek === 'monday' ? (d.getDay() + 6) % 7 : d.getDay();
  d.setDate(d.getDate() - back);
  return localDateKey(d.getTime());
}

/** Compact event shape for the renderer's live feed. */
export function toFeedEvent(e: UsageEntry, cost: number): FeedEvent {
  return {
    key: e.key,
    ts: e.ts,
    model: e.model,
    project: e.project,
    sessionId: e.sessionId,
    sidechain: e.sidechain,
    in: e.in,
    out: e.out,
    read: e.read,
    write: e.w5m + e.w1h,
    ctx: e.in + e.read + e.w5m + e.w1h, // context-window footprint of this turn
    cost: cost || 0,
  };
}

const sumRow = (): SumRow => ({ cost: 0, in: 0, out: 0, read: 0, write: 0, entries: 0 });

function addTo(row: SumRow, e: UsageEntry, cost: number, write: number): void {
  row.cost += cost;
  row.in += e.in;
  row.out += e.out;
  row.read += e.read;
  row.write += write;
  row.entries += 1;
}

/** Consecutive-active-day streaks over ascending day keys. */
function computeStreaks(
  activeKeys: string[],
  todayKey: string,
  yesterdayKey: string,
): { current: number; longest: number } {
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const k of activeKeys) {
    run = prev && dateAtNoon(k).getTime() - dateAtNoon(prev).getTime() === DAY_MS ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = k;
  }
  // Current streak counts back from today (grace: from yesterday if today is
  // quiet so the number doesn't flicker to 0 each morning).
  const active = new Set(activeKeys);
  let cursor = active.has(todayKey) ? todayKey : active.has(yesterdayKey) ? yesterdayKey : null;
  let current = 0;
  while (cursor && active.has(cursor)) {
    current += 1;
    const d = dateAtNoon(cursor);
    d.setDate(d.getDate() - 1);
    cursor = localDateKey(d.getTime());
  }
  return { current, longest };
}

/**
 * Strip numeric / version prefixes from folder names (e.g. '0_CONFIG' -> 'config', '1_DRIVERS' -> 'drivers', '04_application' -> 'application', 'v1_api' -> 'api').
 */
function normalizeSegment(seg: string): string {
  return seg.toLowerCase().replace(/^(\d+[-_.]|v\d+[-_.])/, '');
}

/**
 * Classify a touched file path into an architectural functional layer using
 * generalized wildcard tokens, segment normalization, and domain heuristics.
 */
export function classifyArchLayer(filePath: string): ArchLayerKey {
  if (!filePath || typeof filePath !== 'string') return 'other';
  const p = filePath.toLowerCase().replace(/\\/g, '/');
  const rawSegments = p.split('/').filter(Boolean);
  const segments = rawSegments.map(normalizeSegment);
  const filename = rawSegments[rawSegments.length - 1] || '';
  const stem = filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename;
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';

  // 1. Tests, QA & Fuzzing
  if (
    segments.some((s) => /^(tests?|__tests__|testing|fuzz|pty|e2e|benchmarks?|bench|specs?|qa)$/.test(s)) ||
    /(\.test\.|\.spec\.|_test\.|test_|_spec\.)/.test(filename)
  ) {
    return 'testing';
  }

  // 2. Documentation, Specs & Architectural Notes
  if (
    segments.some((s) => /^(docs?|documentation|specs?|rfc|decisions?|tracking|guides?|invariants?|notes?|wiki|changelog)$/.test(s)) ||
    ['.md', '.mdx', '.rst', '.txt', '.pdf'].includes(ext) ||
    ['doxyfile', 'license', 'changelog', 'contributing', 'notice'].includes(filename)
  ) {
    return 'docs';
  }

  // 3. Agent Skills, Sidecars & CLI Extensions
  if (
    segments.some((s) => /^(skills|\.claude|\.codex|\.cursor|\.gemini|\.agents)$/.test(s)) ||
    p.includes('/.claude/skills/')
  ) {
    return 'skills';
  }

  // 4. Data Science, Machine Learning & AI
  if (
    segments.some((s) => /^(notebooks?|training|datasets?|ml|ai|evaluation|weights|embeddings?)$/.test(s)) ||
    ['.ipynb', '.onnx', '.pt', '.pth', '.pkl', '.parquet', '.h5', '.arrow'].includes(ext) ||
    stem.includes('embedding')
  ) {
    return 'ml';
  }

  // 5. Embedded, Hardware, Drivers & Firmware
  if (
    segments.some((s) => /^(drivers?|hal|hardware|firmware|bootloaders?|stm32|esp32|esp-idf|freertos|bsp|serial|uart|spi|i2c|gpio|nvs|led|can|watchdog|ros|urdf)$/.test(s)) ||
    ['.ino', '.hex', '.sv', '.vhd', '.v'].includes(ext) ||
    stem.includes('driver') ||
    stem.includes('bootloader') ||
    stem.includes('watchdog') ||
    stem.includes('fault') ||
    stem.includes('bsp') ||
    stem.includes('stm32') ||
    stem.includes('esp32')
  ) {
    return 'embedded';
  }

  // 6. Protocols, Transport & Networking
  if (
    segments.some((s) => /^(proto|protocols?|transports?|framing|networking|network)$/.test(s)) ||
    ['xmodem', 'ymodem', 'zmodem', 'passthrough', 'protocol', 'tcp', 'udp', 'mqtt', 'wifi', 'mavlink', 'nmea', 'canbus', 'osc'].some((k) => stem.includes(k))
  ) {
    return 'proto';
  }

  // 7. TUI, Terminal UI & CLI Rendering
  if (
    segments.some((s) => /^(tui|render|rendering|hud|pager|scrollback|terminal|cli|console|prompts?|completions?)$/.test(s)) ||
    ['sparkline', 'pager', 'scrollback', 'hud', 'fuzzy', 'completions'].some((k) => stem.includes(k))
  ) {
    return 'tui';
  }

  // 8. Mobile & Native Apps
  if (
    segments.some((s) => /^(ios|android|flutter|react-native)$/.test(s)) ||
    ['.swift', '.kt', '.dart', '.m'].includes(ext)
  ) {
    return 'mobile';
  }

  // 9. Smart Contracts & Web3
  if (
    segments.some((s) => /^(contracts?|solidity|circuit)$/.test(s)) ||
    ['.sol', '.cairo', '.vy'].includes(ext)
  ) {
    return 'contracts';
  }

  // 10. DevOps, Cloud, CI/CD & Build Scripts
  if (
    segments.some((s) => /^(\.github|\.gitlab|docker|deploy|deployment|infra|infrastructure|k8s|helm|terraform|scripts?|packaging|releases?|ci|cd)$/.test(s)) ||
    ['dockerfile', 'docker-compose.yml', 'makefile', 'cmakelists.txt', 'build.sh'].includes(filename) ||
    ['.yml', '.yaml', '.sh', '.bash', '.deb'].includes(ext)
  ) {
    return 'devops';
  }

  // 11. Configuration & Board Settings
  if (
    segments.some((s) => /^(configs?|settings?|configurations?)$/.test(s)) ||
    ['package.json', 'tsconfig.json', 'cargo.toml', 'go.mod', 'go.sum', 'pyproject.toml', 'pom.xml', '.env', '.env.example'].includes(filename) ||
    stem.includes('config') ||
    stem.includes('sdkconfig')
  ) {
    return 'config';
  }

  // 12. UI, Editor & Frontend
  if (
    segments.some((s) => /^(frontend|ui|components?|views?|pages?|styles?|layouts?|editor|renderer|web_interface|web)$/.test(s)) ||
    ['.tsx', '.jsx', '.vue', '.svelte', '.html', '.css', '.scss', '.less'].includes(ext)
  ) {
    return 'frontend';
  }

  // 13. Backend Services & API
  if (
    segments.some((s) => /^(backend|api|server|services?|controllers?|routes?|handlers?|endpoints?|db|database|graphql|grpc|application|apps?)$/.test(s)) ||
    ['service', 'repository', 'controller', 'handler', 'route', 'resolver', 'migration'].some((k) => stem.includes(k))
  ) {
    return 'backend';
  }

  // 14. Core Systems, State Machines & Runtime Engine
  if (
    segments.some((s) => /^(core|engine|lib|libs|loop|runtime|sm|state|dispatch|scheduler|sys_mgr|managers?)$/.test(s)) ||
    ['dispatch', 'event_bus', 'scheduler', 'state_machine', 'runtime', 'tasks', 'rx_thread'].some((k) => stem.includes(k)) ||
    ['.py', '.go', '.rs', '.cpp', '.c', '.h', '.hpp', '.java', '.ts', '.js'].includes(ext)
  ) {
    return 'core';
  }

  return 'other';
}

const LAYER_META: Record<ArchLayerKey, { label: string; color: string }> = {
  core: { label: 'Core Systems & Logic', color: 'var(--amber)' },
  proto: { label: 'Protocols & Transport', color: '#14b8a6' },
  tui: { label: 'TUI & Terminal UI', color: '#a855f7' },
  embedded: { label: 'Embedded & Hardware', color: '#06b6d4' },
  backend: { label: 'Backend & Services', color: '#f59e0b' },
  frontend: { label: 'UI & Frontend', color: '#38bdf8' },
  ml: { label: 'Data Science & ML', color: '#ec4899' },
  mobile: { label: 'Mobile & Apps', color: '#8b5cf6' },
  contracts: { label: 'Smart Contracts', color: '#6366f1' },
  testing: { label: 'Testing & QA', color: 'var(--sage)' },
  docs: { label: 'Docs & Specs', color: 'var(--chart-4)' },
  devops: { label: 'DevOps & Infra', color: 'var(--chart-5)' },
  skills: { label: 'Agent Skills', color: 'var(--chart-6)' },
  config: { label: 'Config & Tooling', color: '#64748b' },
  other: { label: 'Other / Utility', color: 'var(--text-faint)' },
};

interface DayAcc extends SumRow {
  sessions: Set<string>;
  models: Map<string, SumRow> | null;
}

interface BucketAcc extends SumRow {
  days: Set<string>;
}

interface ModelAcc extends SumRow {
  model: string;
  sessions: Set<string>;
  firstTs: number;
  lastTs: number;
}

interface ProjectAcc extends SumRow {
  path: string;
  todayCost: number;
  weekCost: number;
  sessions: Set<string>;
  lastTs: number;
  sidechainCost: number;
  daily: Map<string, number> | null;
  layerMap: Map<ArchLayerKey, { cost: number; tokens: number; touches: number }>;
  hotspotMap: Map<
    string,
    {
      file: string;
      shortPath: string;
      layer: ArchLayerKey;
      touches: number;
      cost: number;
      tokens: number;
      sessions: Set<string>;
      lastTs: number;
    }
  >;
}

interface SessionAcc extends SumRow {
  id: string;
  project: string;
  firstTs: number;
  lastTs: number;
  models: Set<string>;
  lastModel: string;
  lastCtx: number;
}

export interface BuildSnapshotOptions {
  now?: number;
  sourceDirs?: string[];
  version?: string;
  pricing?: PricingEngine | null;
  settings?: Partial<AppSettings>;
  resetTs?: number | null;
  /** compaction markers from the watcher, ALREADY scope-filtered by main */
  compactions?: CompactMarker[] | null;
  /** tool_result volume by local day from the watcher, ALREADY scope-merged by main */
  toolResults?: ToolResultByDay | null;
  /**
   * ALL entries (scope-independent) for the per-account spend rollup. Defaults
   * to the scoped `entries`; main passes the full set so the accounts
   * dashboard can show every login regardless of the current data scope.
   */
  accountEntries?: UsageEntry[];
  /**
   * Global analytics time range (already resolved against `now`). When bounded,
   * the historical body is computed over entries within the range and the daily
   * series spans it. Omitted/`all` = lifetime with the default window (the
   * pre-range behavior — keeps ccusage parity unchanged).
   */
  range?: ResolvedRange | null;
}

/**
 * Lifetime + recent spend bucketed by account root (`e.source`). A lean pass —
 * sums and small per-source session Sets only — so it can run over the FULL
 * entry set (every login) without the Map/Set churn of buildSnapshot. Cost
 * resolves via costForMode, matching the rest of the engine.
 */
export function accountSpend(
  entries: UsageEntry[],
  {
    pricing = null,
    costMode = 'auto',
    now = Date.now(),
    timezone = null,
  }: {
    pricing?: PricingEngine | null;
    costMode?: CostMode;
    now?: number;
    timezone?: Zone;
  } = {},
): AccountSpendMap {
  const costOf = (e: UsageEntry) => (pricing ? costForMode(e, costMode, pricing) : e.costUSD || 0);
  const todayKey = dayKeyFor(now, timezone);
  const weekCut = now - 7 * DAY_MS;
  const monthCut = now - 30 * DAY_MS;
  interface Acc {
    cost: number;
    in: number;
    out: number;
    read: number;
    write: number;
    entries: number;
    sessions: Set<string>;
    firstTs: number;
    lastTs: number;
    today: number;
    week: number;
    month: number;
  }
  const map = new Map<string, Acc>();
  for (const e of entries) {
    const src = e.source ?? '';
    let a = map.get(src);
    if (!a) {
      a = {
        cost: 0,
        in: 0,
        out: 0,
        read: 0,
        write: 0,
        entries: 0,
        sessions: new Set(),
        firstTs: e.ts,
        lastTs: e.ts,
        today: 0,
        week: 0,
        month: 0,
      };
      map.set(src, a);
    }
    const cost = costOf(e);
    a.cost += cost;
    a.in += e.in;
    a.out += e.out;
    a.read += e.read;
    a.write += e.w5m + e.w1h;
    a.entries += 1;
    a.sessions.add(e.sessionId);
    if (e.ts < a.firstTs) a.firstTs = e.ts;
    if (e.ts > a.lastTs) a.lastTs = e.ts;
    if (e.dateKey === todayKey) a.today += cost;
    if (e.ts >= weekCut) a.week += cost;
    if (e.ts >= monthCut) a.month += cost;
  }
  const out: AccountSpendMap = {};
  for (const [src, a] of map) {
    if (!src) continue; // entries with no stamped source can't be attributed
    out[src] = {
      cost: a.cost,
      tokens: a.in + a.out,
      allTokens: a.in + a.out + a.read + a.write,
      entries: a.entries,
      sessions: a.sessions.size,
      firstTs: a.entries ? a.firstTs : null,
      lastTs: a.entries ? a.lastTs : null,
      today: a.today,
      week: a.week,
      month: a.month,
    };
  }
  return out;
}

/** Median of a numeric array (sorted copy); 0 for empty. */
function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * "Why was this day expensive": an on-demand breakdown of ONE local day,
 * recomputed from the (already scope-filtered) entries. Ranks the projects,
 * models, and sessions that drove the day's cost, counts tool turns and
 * compactions, flags projects that debuted that day, and compares the day to
 * the median active day in scope. Cost resolves via costForMode like the rest
 * of the engine. Returns null only when the day has no entries.
 */
export function dayBreakdown(
  entries: UsageEntry[],
  dateKey: string,
  {
    pricing = null,
    costMode = 'auto',
    compactions = null,
    timezone = null,
  }: {
    pricing?: PricingEngine | null;
    costMode?: CostMode;
    compactions?: CompactMarker[] | null;
    timezone?: Zone;
  } = {},
): DayBreakdown | null {
  const costOf = (e: UsageEntry) => (pricing ? costForMode(e, costMode, pricing) : e.costUSD || 0);
  const dayCost = new Map<string, number>(); // dateKey → total cost (for the median baseline)
  const projFirstTs = new Map<string, number>(); // project → earliest ts in scope
  const proj = new Map<string, number>(); //    project → cost on this day
  const modelC = new Map<string, number>(); //  model   → cost on this day
  const sess = new Map<string, { project: string; cost: number }>(); // session → cost on this day
  let cost = 0;
  let inTok = 0;
  let outTok = 0;
  let entryCount = 0;
  let toolTurns = 0;
  let toolInvocations = 0;
  const daySessions = new Set<string>();

  for (const e of entries) {
    const c = costOf(e);
    const pPath = resolveProjectRoot(e.project);
    dayCost.set(e.dateKey, (dayCost.get(e.dateKey) || 0) + c);
    const pf = projFirstTs.get(pPath);
    if (pf === undefined || e.ts < pf) projFirstTs.set(pPath, e.ts);
    if (e.dateKey !== dateKey) continue;

    cost += c;
    inTok += e.in;
    outTok += e.out;
    entryCount += 1;
    daySessions.add(e.sessionId);
    proj.set(pPath, (proj.get(pPath) || 0) + c);
    modelC.set(e.model, (modelC.get(e.model) || 0) + c);
    const sv = sess.get(e.sessionId);
    if (sv) sv.cost += c;
    else sess.set(e.sessionId, { project: pPath, cost: c });
    if (e.tools?.length) {
      toolTurns += 1;
      toolInvocations += e.tools.length;
    }
  }

  if (!entryCount) return null;

  const share = (v: number) => (cost > 0 ? (v / cost) * 100 : 0);
  const topN = <T>(arr: T[], by: (t: T) => number, n = 5) =>
    [...arr].sort((a, b) => by(b) - by(a)).slice(0, n);

  // labels stay RAW (path / model id) — the renderer applies projectName /
  // shortModel, matching how every other rollup is formatted
  const topProjects: DayContributor[] = topN([...proj.entries()], ([, c]) => c).map(([key, c]) => ({
    key,
    label: key,
    cost: c,
    pct: share(c),
  }));
  const topModels: DayContributor[] = topN([...modelC.entries()], ([, c]) => c).map(([key, c]) => ({
    key,
    label: key,
    cost: c,
    pct: share(c),
  }));
  const topSessions: DayContributor[] = topN([...sess.entries()], ([, v]) => v.cost).map(
    ([key, v]) => ({ key, label: v.project, cost: v.cost, pct: share(v.cost) }),
  );

  const med = median([...dayCost.values()].filter((c) => c > 0));
  const newProjects = [...proj.keys()].filter((p) => {
    const ft = projFirstTs.get(p);
    return ft !== undefined && dayKeyFor(ft, timezone) === dateKey;
  });
  const dayCompactions = (compactions || []).filter(
    (c) => dayKeyFor(c.ts, timezone) === dateKey,
  ).length;

  return {
    date: dateKey,
    cost,
    tokens: inTok + outTok,
    entries: entryCount,
    sessions: daySessions.size,
    medianCost: med,
    vsMedianPct: med > 0 ? ((cost - med) / med) * 100 : null,
    topProjects,
    topModels,
    topSessions,
    toolTurns,
    toolInvocations,
    compactions: dayCompactions,
    newProjects, // raw paths — renderer shortens
  };
}

/**
 * Reduce all entries into the snapshot v2 (docs/v2-spec.md §4).
 *
 * Deliberately a full recompute: one main pass over the entries plus small
 * post-passes; ~45k entries reduce in ~200 ms, the recompute is debounced in
 * the main process (250 ms, 60 s cadence), and every derived number stays
 * trivially consistent. Per-entry dollars resolve exactly once (costMemo).
 * The full-recompute design hits a wall around ~500k entries — the planned
 * fix is incremental day-bucket aggregation (see docs/analytics-roadmap.md).
 * Per-entry dollars come from costForMode so cost-mode / pricing changes
 * apply without rescanning transcripts.
 */
export function buildSnapshot(
  entries: UsageEntry[],
  {
    now = Date.now(),
    sourceDirs = [],
    version = '',
    pricing = null,
    settings = {},
    resetTs = null,
    compactions = null,
    toolResults = null,
    accountEntries,
    range = null,
  }: BuildSnapshotOptions = {},
): Snapshot {
  const costMode = settings.costMode || 'auto';
  const startOfWeek: StartOfWeek = settings.startOfWeek === 'monday' ? 'monday' : 'sunday';
  // '' (the default) means the system zone — dayKeyFor treats falsy as system
  const zone: Zone = settings.timezone || null;
  const costOf = (e: UsageEntry) => (pricing ? costForMode(e, costMode, pricing) : e.costUSD || 0);
  // per-entry dollars are resolved exactly once — blocks and the feed reuse
  // the memo instead of running a second pricing pass over every entry
  const costMemo = new WeakMap<UsageEntry, number>();
  const costOfMemo = (e: UsageEntry) => costMemo.get(e) ?? costOf(e);

  // resolved range carried onto the snapshot for labels; 'all' when none given
  const resolvedRange: ResolvedRange = range ?? {
    preset: 'all',
    startKey: null,
    endKey: null,
    label: 'all time',
  };
  // restrict the historical body to the range. Markers (compactions / tool
  // results) are filtered to match so their counts track the same window.
  // accountEntries (per-account spend) and live limits are NOT range-scoped.
  const bounded = isBoundedRange(resolvedRange);
  if (bounded) {
    entries = entries.filter((e) => dayKeyInRange(e.dateKey, resolvedRange));
    if (compactions) {
      compactions = compactions.filter((c) => dayKeyInRange(dayKeyFor(c.ts, zone), resolvedRange));
    }
    if (toolResults) {
      const f: ToolResultByDay = new Map();
      for (const [day, b] of toolResults) if (dayKeyInRange(day, resolvedRange)) f.set(day, b);
      toolResults = f;
    }
  }

  const dayKeys = dayKeysForRange(resolvedRange, now, zone);
  const DAY_SLOTS = dayKeys.length;
  const dayIndex = new Map<string, number>(dayKeys.map((k, i) => [k, i]));
  const todayKey = dayKeys[dayKeys.length - 1];
  const yesterdayKey = dayKeys[dayKeys.length - 2];
  const daysWindow = new Set(dayKeys);
  const projDayKeys = dayKeys.slice(-PROJECT_DAYS);
  const projDaySet = new Set(projDayKeys);
  const weekSet = new Set(dayKeys.slice(-7));
  // heat window follows the range when bounded, else the rolling 30-day rhythm
  const heatCutoff =
    bounded && resolvedRange.startKey
      ? dateAtNoon(resolvedRange.startKey).getTime()
      : now - HEAT_DAYS * DAY_MS;

  const totals = { cost: 0, in: 0, out: 0, read: 0, write: 0 };
  const allSessions = new Set<string>();
  const dayMap = new Map<string, DayAcc>(); //  dateKey → day row (all time — records/weekly/monthly)
  const weekKeyMemo = new Map<string, string>(); // dateKey → week bucket key
  const weekMap = new Map<string, BucketAcc>(); // weekKey → bucket
  const monthMap = new Map<string, BucketAcc>(); // 'YYYY-MM' → bucket
  const modelMap = new Map<string, ModelAcc>();
  const projMap = new Map<string, ProjectAcc>();
  const sessMap = new Map<string, SessionAcc>();
  const hourly: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  const hourlyCost: number[][] = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let cacheSavedUSD = 0;
  const idle = { events: 0, tokens: 0, extraUSD: 0 };
  const sidechain = { cost: 0, entries: 0 };
  const toolMap = new Map<
    string,
    { name: string; invocations: number; entries: number; cost: number }
  >();
  const toolDayMap = new Map<string, number[]>(); // tool → invocations per window day
  let toolTurns = 0;
  let toolInvocations = 0;
  const layerMap = new Map<ArchLayerKey, { cost: number; tokens: number; touches: number }>();
  const hotspotMap = new Map<
    string,
    {
      file: string;
      shortPath: string;
      layer: ArchLayerKey;
      touches: number;
      cost: number;
      tokens: number;
      sessions: Set<string>;
      lastTs: number;
    }
  >();
  const moduleMap = new Map<
    string,
    {
      name: string;
      cost: number;
      tokens: number;
      touches: number;
      files: Set<string>;
      layer: ArchLayerKey;
    }
  >();
  let totalFileTouches = 0;
  const stopReasons: Record<string, number> = {};
  const compactBySession = new Map<string, number>();
  // pending compaction timestamps per session (ascending) — drained in the main
  // loop to attribute the first post-compaction turn's re-read cost
  const compactQueue = new Map<string, number[]>();
  for (const c of compactions || []) {
    compactBySession.set(c.sessionId, (compactBySession.get(c.sessionId) || 0) + 1);
    let q = compactQueue.get(c.sessionId);
    if (!q) compactQueue.set(c.sessionId, (q = []));
    q.push(c.ts);
  }
  for (const q of compactQueue.values()) q.sort((a, b) => a - b);
  const compactionReread = { costUSD: 0, turns: 0 };
  // input+cache-read cost only (the re-read), never the fresh output generation
  const rereadSplit = { in: 0, out: 0, read: 0, w5m: 0, w1h: 0 };
  const rereadCostOf = (e: UsageEntry): number => {
    if (!pricing) return 0;
    const row = pricing.rates(e.model);
    if (!row) return 0;
    rereadSplit.in = e.in;
    rereadSplit.read = e.read;
    return costWith(row, rereadSplit);
  };

  // Recorded-vs-calculated reconciliation, folded into the main pass rather than
  // a second sweep (a per-entry pass at this scale is not free — see CLAUDE.md).
  // `calcOf` is deliberately NOT costOf: under 'auto'/'display' the snapshot's
  // cost already IS the recorded value, so drift would be 0 by construction.
  const rec = { compared: 0, recorded: 0, calculated: 0 };
  const recByDay = new Map<string, { recorded: number; calculated: number; entries: number }>();
  const recByModel = new Map<string, { recorded: number; calculated: number; entries: number }>();
  const calcOf = (e: UsageEntry): number | null =>
    pricing ? pricing.costAt(e.model, e, e.dateKey) : null;

  for (const e of entries) {
    const write = e.w5m + e.w1h;
    const cost = costOf(e);
    costMemo.set(e, cost);

    if (e.costUSD != null) {
      const calc = calcOf(e);
      // an unpriced model has nothing to compare against — skip rather than
      // score it as a 100% overstatement
      if (calc != null) {
        rec.compared += 1;
        rec.recorded += e.costUSD;
        rec.calculated += calc;
        const d = recByDay.get(e.dateKey);
        if (d) {
          d.recorded += e.costUSD;
          d.calculated += calc;
          d.entries += 1;
        } else {
          recByDay.set(e.dateKey, { recorded: e.costUSD, calculated: calc, entries: 1 });
        }
        const m = recByModel.get(e.model);
        if (m) {
          m.recorded += e.costUSD;
          m.calculated += calc;
          m.entries += 1;
        } else {
          recByModel.set(e.model, { recorded: e.costUSD, calculated: calc, entries: 1 });
        }
      }
    }
    totals.cost += cost;
    totals.in += e.in;
    totals.out += e.out;
    totals.read += e.read;
    totals.write += write;
    allSessions.add(e.sessionId);

    if (e.sidechain) {
      sidechain.cost += cost;
      sidechain.entries += 1;
    }

    // first turn at/after one or more pending compactions in this session pays
    // to re-ingest the summarized context — attribute its input+read cost once
    const cq = compactQueue.get(e.sessionId);
    if (cq && cq.length && cq[0] <= e.ts) {
      let popped = 0;
      while (cq.length && cq[0] <= e.ts) {
        cq.shift();
        popped += 1;
      }
      if (popped > 0) {
        compactionReread.turns += 1;
        compactionReread.costUSD += rereadCostOf(e);
      }
    }

    if (e.stop) stopReasons[e.stop] = (stopReasons[e.stop] || 0) + 1;

    if (e.tools?.length) {
      toolTurns += 1;
      toolInvocations += e.tools.length;
      const di = dayIndex.get(e.dateKey);
      const bumpDay = (name: string) => {
        if (di === undefined) return;
        let arr = toolDayMap.get(name);
        if (!arr) toolDayMap.set(name, (arr = new Array<number>(DAY_SLOTS).fill(0)));
        arr[di] += 1;
      };
      if (e.tools.length === 1) {
        // dominant case — skip the distinct-tool Set allocation
        const name = e.tools[0];
        let t = toolMap.get(name);
        if (!t) toolMap.set(name, (t = { name, invocations: 0, entries: 0, cost: 0 }));
        t.invocations += 1;
        t.entries += 1;
        t.cost += cost;
        bumpDay(name);
      } else {
        // per-tool cost counts the whole turn once per DISTINCT tool in it
        const seen = new Set<string>();
        for (const name of e.tools) {
          let t = toolMap.get(name);
          if (!t) toolMap.set(name, (t = { name, invocations: 0, entries: 0, cost: 0 }));
          t.invocations += 1;
          bumpDay(name);
          if (!seen.has(name)) {
            seen.add(name);
            t.entries += 1;
            t.cost += cost;
          }
        }
      }
    }

    if (e.read && pricing) {
      const r = pricing.rates(e.model);
      if (r) cacheSavedUSD += e.read * (r.input - r.cacheRead);
    }

    // day (all time; per-model split only inside the 35-day chart window)
    let d = dayMap.get(e.dateKey);
    if (!d) {
      d = { ...sumRow(), sessions: new Set(), models: null };
      dayMap.set(e.dateKey, d);
    }
    addTo(d, e, cost, write);
    d.sessions.add(e.sessionId);
    if (daysWindow.has(e.dateKey)) {
      if (!d.models) d.models = new Map();
      let dm = d.models.get(e.model);
      if (!dm) d.models.set(e.model, (dm = sumRow()));
      addTo(dm, e, cost, write);
    }

    // weekly / monthly
    let wk = weekKeyMemo.get(e.dateKey);
    if (!wk) {
      wk = weekStartKey(e.dateKey, startOfWeek);
      weekKeyMemo.set(e.dateKey, wk);
    }
    let w = weekMap.get(wk);
    if (!w) weekMap.set(wk, (w = { ...sumRow(), days: new Set() }));
    addTo(w, e, cost, write);
    w.days.add(e.dateKey);

    const mk = e.dateKey.slice(0, 7);
    let mo = monthMap.get(mk);
    if (!mo) monthMap.set(mk, (mo = { ...sumRow(), days: new Set() }));
    addTo(mo, e, cost, write);
    mo.days.add(e.dateKey);

    // model
    let m = modelMap.get(e.model);
    if (!m) {
      m = { model: e.model, ...sumRow(), sessions: new Set(), firstTs: e.ts, lastTs: e.ts };
      modelMap.set(e.model, m);
    }
    addTo(m, e, cost, write);
    m.sessions.add(e.sessionId);
    if (e.ts < m.firstTs) m.firstTs = e.ts;
    if (e.ts > m.lastTs) m.lastTs = e.ts;

    // project
    const pPath = resolveProjectRoot(e.project);
    let p = projMap.get(pPath);
    if (!p) {
      p = {
        path: pPath,
        ...sumRow(),
        todayCost: 0,
        weekCost: 0,
        sessions: new Set(),
        lastTs: 0,
        sidechainCost: 0,
        daily: null,
        layerMap: new Map(),
        hotspotMap: new Map(),
      };
      projMap.set(pPath, p);
    }
    addTo(p, e, cost, write);
    if (e.sidechain) p.sidechainCost += cost;
    if (e.dateKey === todayKey) p.todayCost += cost;
    if (weekSet.has(e.dateKey)) p.weekCost += cost;
    p.sessions.add(e.sessionId);
    if (e.ts > p.lastTs) p.lastTs = e.ts;
    if (projDaySet.has(e.dateKey)) {
      if (!p.daily) p.daily = new Map();
      p.daily.set(e.dateKey, (p.daily.get(e.dateKey) || 0) + cost);
    }

    // session — first, cache-TTL idle re-write detection against the
    // session's previous entry (entries arrive ts-ascending): a gap past a
    // tier's TTL means this entry's writes re-pay cache the session had
    if (e.w5m || e.w1h) {
      const prevTs = sessMap.get(e.sessionId)?.lastTs;
      if (prevTs !== undefined) {
        const gap = e.ts - prevTs;
        const w5 = gap > TTL_5M_MS ? e.w5m : 0;
        const w1 = gap > TTL_1H_MS ? e.w1h : 0;
        if (w5 || w1) {
          idle.events += 1;
          idle.tokens += w5 + w1;
          const r = pricing?.rates(e.model);
          if (r) {
            if (w5) idle.extraUSD += w5 * Math.max(0, r.cacheCreate - r.cacheRead);
            if (w1)
              idle.extraUSD += w1 * Math.max(0, (r.cacheCreate1h ?? r.input * 2) - r.cacheRead);
          }
        }
      }
    }
    let s = sessMap.get(e.sessionId);
    if (!s) {
      s = {
        id: e.sessionId,
        project: pPath,
        ...sumRow(),
        firstTs: e.ts,
        lastTs: e.ts,
        models: new Set(),
        lastModel: e.model,
        lastCtx: 0,
      };
      sessMap.set(e.sessionId, s);
    }
    addTo(s, e, cost, write);
    s.models.add(e.model);
    if (e.ts < s.firstTs) s.firstTs = e.ts;
    if (e.ts >= s.lastTs) {
      s.lastTs = e.ts;
      s.project = pPath;
      s.lastModel = e.model;
      s.lastCtx = e.in + e.read + e.w5m + e.w1h;
    }

    if (e.ts >= heatCutoff) {
      // the rhythm heatmap is a WALL-CLOCK view, so it follows the same zone as
      // the day buckets — otherwise "your quiet hour" would be someone else's
      const { weekday: wd, hour: hr } = zonedParts(e.ts, zone);
      hourly[wd][hr] += e.in + e.out;
      hourlyCost[wd][hr] += cost;
    }

    // file & layer knowledge tracking
    if (e.files?.length) {
      const costPerFile = cost / e.files.length;
      const tokPerFile = (e.in + e.out) / e.files.length;
      for (const rawF of e.files) {
        totalFileTouches += 1;
        const layer = classifyArchLayer(rawF);
        let lm = layerMap.get(layer);
        if (!lm) layerMap.set(layer, (lm = { cost: 0, tokens: 0, touches: 0 }));
        lm.cost += costPerFile;
        lm.tokens += tokPerFile;
        lm.touches += 1;

        const normF = rawF.replace(/\\/g, '/');
        const parts = normF.split('/').filter(Boolean);
        const shortPath = parts.slice(-3).join('/') || normF;
        let hs = hotspotMap.get(normF);
        if (!hs) {
          hotspotMap.set(
            normF,
            (hs = {
              file: normF,
              shortPath,
              layer,
              touches: 0,
              cost: 0,
              tokens: 0,
              sessions: new Set(),
              lastTs: e.ts,
            }),
          );
        }
        hs.touches += 1;
        hs.cost += costPerFile;
        hs.tokens += tokPerFile;
        hs.sessions.add(e.sessionId);
        if (e.ts > hs.lastTs) hs.lastTs = e.ts;

        // per-project layer tracking
        let plm = p.layerMap.get(layer);
        if (!plm) p.layerMap.set(layer, (plm = { cost: 0, tokens: 0, touches: 0 }));
        plm.cost += costPerFile;
        plm.tokens += tokPerFile;
        plm.touches += 1;

        // per-project hotspot tracking
        let phs = p.hotspotMap.get(normF);
        if (!phs) {
          p.hotspotMap.set(
            normF,
            (phs = {
              file: normF,
              shortPath,
              layer,
              touches: 0,
              cost: 0,
              tokens: 0,
              sessions: new Set(),
              lastTs: e.ts,
            }),
          );
        }
        phs.touches += 1;
        phs.cost += costPerFile;
        phs.tokens += tokPerFile;
        phs.sessions.add(e.sessionId);
        if (e.ts > phs.lastTs) phs.lastTs = e.ts;

        const modName = parts.length > 2 ? parts.slice(0, 2).join('/') : parts[0] || 'root';
        let mod = moduleMap.get(modName);
        if (!mod) {
          moduleMap.set(
            modName,
            (mod = {
              name: modName,
              cost: 0,
              tokens: 0,
              touches: 0,
              files: new Set(),
              layer,
            }),
          );
        }
        mod.cost += costPerFile;
        mod.tokens += tokPerFile;
        mod.touches += 1;
        mod.files.add(normF);
      }
    }
  }

  // ---- post-passes -------------------------------------------------------

  const days: DayRow[] = dayKeys.map((k) => {
    const d = dayMap.get(k);
    if (!d) {
      return {
        date: k,
        cost: 0,
        in: 0,
        out: 0,
        read: 0,
        write: 0,
        tokens: 0,
        allTokens: 0,
        entries: 0,
        sessions: 0,
        models: [],
      };
    }
    return {
      date: k,
      cost: d.cost,
      in: d.in,
      out: d.out,
      read: d.read,
      write: d.write,
      tokens: d.in + d.out,
      allTokens: d.in + d.out + d.read + d.write,
      entries: d.entries,
      sessions: d.sessions.size,
      models: d.models
        ? [...d.models.entries()]
            .map(([model, r]) => ({ model, ...r }))
            .sort((a, b) => b.cost - a.cost)
        : [],
    };
  });

  const today = days[days.length - 1];
  const yesterday = days[days.length - 2];
  const week = days
    .slice(-7)
    .reduce((acc, d) => ({ cost: acc.cost + d.cost, tokens: acc.tokens + d.tokens }), {
      cost: 0,
      tokens: 0,
    });

  const weekly: WeeklyRow[] = [...weekMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-WEEKLY_BUCKETS)
    .map(([weekKey, w]) => ({
      week: weekKey,
      cost: w.cost,
      in: w.in,
      out: w.out,
      read: w.read,
      write: w.write,
      tokens: w.in + w.out,
      entries: w.entries,
      days: w.days.size,
    }));

  const monthly: MonthlyRow[] = [...monthMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-MONTHLY_BUCKETS)
    .map(([month, m]) => ({
      month,
      cost: m.cost,
      in: m.in,
      out: m.out,
      read: m.read,
      write: m.write,
      tokens: m.in + m.out,
      entries: m.entries,
      days: m.days.size,
    }));

  const models: ModelRow[] = [...modelMap.values()]
    .map((m) => {
      const row = pricing?.rates(m.model);
      return {
        model: m.model,
        cost: m.cost,
        in: m.in,
        out: m.out,
        read: m.read,
        write: m.write,
        entries: m.entries,
        sessions: m.sessions.size,
        firstTs: m.firstTs,
        lastTs: m.lastTs,
        inputRate: row ? row.input * 1e6 : null,
        outputRate: row ? row.output * 1e6 : null,
      };
    })
    .sort((a, b) => b.cost - a.cost);

  const projects: ProjectRow[] = [...projMap.values()]
    .sort((a, b) => b.lastTs - a.lastTs)
    .slice(0, PROJECT_LIMIT)
    .map((p) => {
      const projKnowledgeCost = [...p.layerMap.values()].reduce((sum, l) => sum + l.cost, 0);
      const pLayers: LayerSpend[] = (Object.keys(LAYER_META) as ArchLayerKey[])
        .map((k) => {
          const lm = p.layerMap.get(k) || { cost: 0, tokens: 0, touches: 0 };
          return {
            key: k,
            label: LAYER_META[k].label,
            cost: lm.cost,
            pct: projKnowledgeCost > 0 ? (lm.cost / projKnowledgeCost) * 100 : 0,
            tokens: Math.round(lm.tokens),
            touches: lm.touches,
            color: LAYER_META[k].color,
          };
        })
        .filter((l) => l.touches > 0 || l.cost > 0)
        .sort((a, b) => b.cost - a.cost);

      const pHotspots: FileHotspot[] = [...p.hotspotMap.values()]
        .sort((a, b) => b.touches - a.touches || b.cost - a.cost)
        .slice(0, 20)
        .map((h) => ({
          file: h.file,
          shortPath: h.shortPath,
          layer: h.layer,
          touches: h.touches,
          cost: h.cost,
          tokens: Math.round(h.tokens),
          sessions: h.sessions.size,
          lastTs: h.lastTs,
        }));

      return {
        path: p.path,
        cost: p.cost,
        todayCost: p.todayCost,
        weekCost: p.weekCost,
        in: p.in,
        out: p.out,
        read: p.read,
        write: p.write,
        tokens: p.in + p.out,
        entries: p.entries,
        sessions: p.sessions.size,
        lastTs: p.lastTs,
        sidechainCost: p.sidechainCost,
        daily: projDayKeys.map((k) => ({ date: k, cost: p.daily?.get(k) || 0 })),
        layers: pLayers,
        hotspots: pHotspots,
      };
    });

  const allSessionRows = [...sessMap.values()].sort((a, b) => b.lastTs - a.lastTs);
  const ctxCutoff = now - CONTEXT_WINDOW_MS;
  const sessions: SessionRow[] = allSessionRows.slice(0, SESSION_LIMIT).map((s) => {
    let context: SessionContext | null = null;
    if (s.lastTs >= ctxCutoff && pricing) {
      const limit = pricing.contextLimit(s.lastModel);
      context = { tokens: s.lastCtx, limit, pct: limit ? (s.lastCtx / limit) * 100 : 0 };
    }
    return {
      id: s.id,
      project: s.project,
      firstTs: s.firstTs,
      lastTs: s.lastTs,
      durationMs: s.lastTs - s.firstTs,
      cost: s.cost,
      in: s.in,
      out: s.out,
      read: s.read,
      write: s.write,
      tokens: s.in + s.out,
      entries: s.entries,
      models: [...s.models],
      compactions: compactBySession.get(s.id) || 0,
      context,
    };
  });

  // ---- what-if: all traffic re-priced onto each top model -------------------
  // Entry-exact counterfactual: every entry's real token splits run through
  // engine.cost for each candidate, so tier rules and cache rates apply the
  // same way they do for actual costs. ~6 candidates × 50k entries is pure
  // arithmetic over memoized rate rows — a few ms.

  const whatIf: WhatIfRow[] = [];
  if (pricing) {
    // candidate rate rows resolve ONCE; the per-entry loop is pure arithmetic
    const candidates: string[] = [];
    const candRows: RateRow[] = [];
    for (const m of models.slice(0, WHATIF_CANDIDATES)) {
      const row = pricing.rates(m.model);
      if (row) {
        candidates.push(m.model);
        candRows.push(row);
      }
    }
    const sums = new Array<number>(candidates.length).fill(0);
    const dailySums = candidates.map(() => new Array<number>(DAY_SLOTS).fill(0));
    const splits = { in: 0, out: 0, read: 0, w5m: 0, w1h: 0 };
    for (const e of entries) {
      splits.in = e.in;
      splits.out = e.out;
      splits.read = e.read;
      splits.w5m = e.w5m;
      splits.w1h = e.w1h;
      const di = dayIndex.get(e.dateKey);
      for (let i = 0; i < candidates.length; i++) {
        const c = costWith(candRows[i], splits);
        sums[i] += c;
        if (di !== undefined) dailySums[i][di] += c;
      }
    }
    candidates.forEach((m, i) =>
      whatIf.push({
        model: m,
        totalCost: sums[i],
        delta: sums[i] - totals.cost,
        daily: dailySums[i],
      }),
    );
    whatIf.sort((a, b) => a.totalCost - b.totalCost);
  }

  // ---- blocks --------------------------------------------------------------

  const blockInfo = computeBlocks(entries, {
    now,
    tokenLimit: settings.tokenLimit !== undefined ? settings.tokenLimit : 'max',
    costOf: costOfMemo,
    blockHours: settings.blockHours ?? null,
  });
  const block = blockInfo.active;
  if (block) block.usageLimitResetTs = resetTs && resetTs > now ? resetTs : null;

  // ---- records --------------------------------------------------------------

  let maxDay: { date: string; cost: number } | null = null;
  for (const [date, d] of dayMap) {
    if (!maxDay || d.cost > maxDay.cost) maxDay = { date, cost: d.cost };
  }
  let longestSession: { id: string; project: string; durationMs: number } | null = null;
  for (const s of sessMap.values()) {
    const durationMs = s.lastTs - s.firstTs;
    if (!longestSession || durationMs > longestSession.durationMs) {
      longestSession = { id: s.id, project: s.project, durationMs };
    }
  }
  const activeKeys = [...dayMap.keys()].sort();
  const firstTs = entries.length ? entries[0].ts : null;
  const lastTs = entries.length ? entries[entries.length - 1].ts : null;
  const totalDays =
    activeKeys.length > 1
      ? Math.round(
          (dateAtNoon(activeKeys[activeKeys.length - 1]).getTime() -
            dateAtNoon(activeKeys[0]).getTime()) /
            DAY_MS,
        ) + 1
      : activeKeys.length;
  const records = {
    maxDay,
    maxBlockTokens: blockInfo.maxBlockTokens,
    longestSession,
    activeDays: activeKeys.length,
    totalDays,
    streak: computeStreaks(activeKeys, todayKey, yesterdayKey),
    avgDailyCost: activeKeys.length ? totals.cost / activeKeys.length : 0,
  };

  // per-account spend covers EVERY login (scope-independent), so it runs over
  // the full set when main supplies it; otherwise it mirrors the scoped pass
  const reconcile: CostReconciliation = {
    compared: rec.compared,
    total: entries.length,
    coverage: entries.length ? rec.compared / entries.length : 0,
    recorded: rec.recorded,
    calculated: rec.calculated,
    drift: rec.calculated - rec.recorded,
    driftPct: rec.recorded ? (rec.calculated - rec.recorded) / rec.recorded : 0,
    byDay: [...recByDay.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a2, b2) => (a2.key < b2.key ? -1 : 1)),
    byModel: [...recByModel.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort(
        (a2, b2) => Math.abs(b2.calculated - b2.recorded) - Math.abs(a2.calculated - a2.recorded),
      ),
  };

  const accountSpendMap = accountSpend(accountEntries ?? entries, {
    pricing,
    costMode,
    now,
    timezone: zone,
  });

  // tool_result volume re-fed as context (estimate; chars/4, not billed)
  let toolResultChars = 0;
  let toolResultCount = 0;
  if (toolResults) {
    for (const b of toolResults.values()) {
      toolResultChars += b.chars;
      toolResultCount += b.count;
    }
  }
  const toolResultsRollup = {
    count: toolResultCount,
    chars: toolResultChars,
    estTokens: Math.round(toolResultChars / 4),
  };

  // ---- architecture layer & knowledge graph assembly ------------------------
  const totalKnowledgeCost = [...layerMap.values()].reduce((sum, l) => sum + l.cost, 0);
  const layers: LayerSpend[] = (Object.keys(LAYER_META) as ArchLayerKey[])
    .map((k) => {
      const lm = layerMap.get(k) || { cost: 0, tokens: 0, touches: 0 };
      return {
        key: k,
        label: LAYER_META[k].label,
        cost: lm.cost,
        pct: totalKnowledgeCost > 0 ? (lm.cost / totalKnowledgeCost) * 100 : 0,
        tokens: Math.round(lm.tokens),
        touches: lm.touches,
        color: LAYER_META[k].color,
      };
    })
    .filter((l) => l.touches > 0 || l.cost > 0)
    .sort((a, b) => b.cost - a.cost);

  const hotspots: FileHotspot[] = [...hotspotMap.values()]
    .sort((a, b) => b.touches - a.touches || b.cost - a.cost)
    .slice(0, 30)
    .map((h) => ({
      file: h.file,
      shortPath: h.shortPath,
      layer: h.layer,
      touches: h.touches,
      cost: h.cost,
      tokens: Math.round(h.tokens),
      sessions: h.sessions.size,
      lastTs: h.lastTs,
    }));

  const modules: ModuleSpend[] = [...moduleMap.values()]
    .sort((a, b) => b.cost - a.cost || b.touches - a.touches)
    .slice(0, 15)
    .map((m) => ({
      name: m.name,
      cost: m.cost,
      tokens: Math.round(m.tokens),
      touches: m.touches,
      filesCount: m.files.size,
      layer: m.layer,
    }));

  const knowledge: KnowledgeGraphData = {
    layers,
    hotspots,
    modules,
    totalFileTouches,
  };

  return {
    generatedAt: now,
    version,
    sourceDirs,
    entryCount: entries.length,
    costMode,
    unknownModels: pricing ? pricing.unknown() : [],
    range: resolvedRange,
    totals: {
      ...totals,
      tokens: totals.in + totals.out,
      allTokens: totals.in + totals.out + totals.read + totals.write,
      entries: entries.length,
      sessions: allSessions.size,
      firstTs,
      lastTs,
    },
    today: {
      ...today,
      vsYesterdayPct:
        yesterday && yesterday.cost > 0
          ? ((today.cost - yesterday.cost) / yesterday.cost) * 100
          : null,
    },
    week,
    days,
    weekly,
    monthly,
    hourly,
    hourlyCost,
    models,
    projects,
    sessions,
    block,
    blocks: blockInfo.blocks,
    blockCount: blockInfo.count,
    // top-level so the UI can show "limit hit · resets in Xm" even when the
    // rejected requests produced no entries (= no active block)
    usageLimitResetTs: resetTs && resetTs > now ? resetTs : null,
    cache: {
      readTokens: totals.read,
      writeTokens: totals.write,
      hitRate: totals.read + totals.in > 0 ? totals.read / (totals.read + totals.in) : 0,
      savedUSD: cacheSavedUSD,
      wouldHaveCostUSD: totals.cost + cacheSavedUSD,
      idle,
    },
    whatIf,
    sidechain,
    toolUse: {
      rows: [...toolMap.values()]
        .sort((a, b) => b.invocations - a.invocations)
        .slice(0, TOOL_LIMIT),
      daily: [...toolDayMap.entries()]
        .map(([name, days]) => ({ name, days, total: days.reduce((a, b) => a + b, 0) }))
        .sort((a, b) => b.total - a.total)
        .slice(0, TOOL_DAILY_LIMIT)
        .map(({ name, days }) => ({ name, days })),
      turns: toolTurns,
      invocations: toolInvocations,
    },
    stopReasons,
    compactions: (compactions || []).length,
    compactionReread,
    toolResults: toolResultsRollup,
    reconcile,
    records,
    recentEvents: entries.slice(-FEED_SEED).map((e) => toFeedEvent(e, costOfMemo(e))),
    knowledge,
    accountSpend: accountSpendMap,
  };
}
