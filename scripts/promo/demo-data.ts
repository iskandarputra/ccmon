/**
 * @file demo-data.ts
 * @brief Synthetic Claude Code transcripts for promo recordings — seeded history, multi-account worlds, and a live ticker.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Generates a fake `<root>/.claude/projects/**` tree that parses, dedupes and
 * prices exactly like real data (validated through the real parser + pricing
 * engine in selfCheck), so promo footage never shows real project names.
 * `generateAccounts()` builds several such roots side by side (`.claude`,
 * `.claude-work`, …) with synthetic identity + credentials, so the accounts
 * dashboard and cross-account headroom render without any real login.
 *
 *   tsx scripts/promo/demo-data.ts [--root DIR] [--days N] [--seed N]
 *   tsx scripts/promo/demo-data.ts --accounts       # build the multi-account world
 *   tsx scripts/promo/demo-data.ts --live           # append entries until killed
 *   tsx scripts/promo/demo-data.ts --check          # validate an existing tree
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseLine } from '../../electron/services/parser';
import { createPricingEngine, costForMode } from '../../electron/services/pricing';
import { PricingArchive } from '../../electron/services/pricing-archive';
import type { UsageEntry } from '../../shared/types';

export const DEFAULT_ROOT = path.join(os.tmpdir(), 'ccmon-demo');

// ---- seeded randomness ----------------------------------------------------

type Rng = () => number;

function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const B62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

class Dice {
  constructor(private readonly rnd: Rng) {}
  f(): number {
    return this.rnd();
  }
  int(a: number, b: number): number {
    return a + Math.floor(this.rnd() * (b - a + 1));
  }
  chance(p: number): boolean {
    return this.rnd() < p;
  }
  pick<T>(items: ReadonlyArray<readonly [T, number]>): T {
    const total = items.reduce((s, [, w]) => s + w, 0);
    let r = this.rnd() * total;
    for (const [v, w] of items) {
      r -= w;
      if (r <= 0) return v;
    }
    return items[items.length - 1][0];
  }
  id(prefix: string, len: number): string {
    let s = prefix;
    for (let i = 0; i < len; i++) s += B62[Math.floor(this.rnd() * 62)];
    return s;
  }
  uuid(): string {
    const h = '0123456789abcdef';
    let s = '';
    for (let i = 0; i < 36; i++) {
      if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
      else if (i === 14) s += '4';
      else if (i === 19) s += h[8 + Math.floor(this.rnd() * 4)];
      else s += h[Math.floor(this.rnd() * 16)];
    }
    return s;
  }
}

// ---- the synthetic world --------------------------------------------------

const WORK_PROJECTS: ReadonlyArray<readonly [string, number]> = [
  ['/home/dev/work/api-gateway', 3.0],
  ['/home/dev/work/web-dashboard', 2.4],
  ['/home/dev/work/payments-service', 1.6],
  ['/home/dev/work/mobile-app', 1.2],
  ['/home/dev/work/ml-pipeline', 1.0],
  ['/home/dev/work/infra', 0.8],
];

const PERSONAL_PROJECTS: ReadonlyArray<readonly [string, number]> = [
  ['/home/dev/oss/ccmon', 1.4],
  ['/home/dev/oss/dotfiles', 0.6],
  ['/home/dev/personal/blog', 0.9],
  ['/home/dev/personal/homelab', 0.7],
  ['/home/dev/oss/cli-tools', 0.5],
];

/** Combined set — single-account generate() keeps its original project mix. */
const PROJECTS: ReadonlyArray<readonly [string, number]> = [...WORK_PROJECTS, ...PERSONAL_PROJECTS];

const MODELS: ReadonlyArray<readonly [string, number]> = [
  ['claude-opus-4-8', 0.5],
  ['claude-fable-5', 0.22],
  ['claude-sonnet-4-6', 0.2],
  ['claude-haiku-4-5-20251001', 0.08],
];

const SIDE_MODELS: ReadonlyArray<readonly [string, number]> = [
  ['claude-haiku-4-5-20251001', 0.55],
  ['claude-sonnet-4-6', 0.45],
];

const TOOLS: ReadonlyArray<readonly [string, number]> = [
  ['Bash', 22],
  ['Read', 20],
  ['Edit', 18],
  ['Grep', 8],
  ['Write', 6],
  ['TodoWrite', 5],
  ['Glob', 4],
  ['Task', 4],
  ['MultiEdit', 4],
  ['WebFetch', 3],
  ['WebSearch', 2],
  ['SlashCommand', 2],
];

/** Relative likelihood that a session starts at a given local hour. */
const HOUR_W = [
  0.2, 0.1, 0.05, 0, 0, 0, 0.05, 0.3, 0.8, 1.4, 1.8, 1.7, 1.0, 1.2, 1.6, 1.8,
  1.9, 1.7, 1.3, 0.9, 0.7, 0.8, 0.6, 0.4,
];

interface EntrySpec {
  ts: number;
  model: string;
  fast: boolean;
  sidechain: boolean;
  in: number;
  out: number;
  read: number;
  w5m: number;
  w1h: number;
  tools: string[];
  stop: string;
}

function encodeProjectDir(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

function entryLine(d: Dice, e: EntrySpec, cwd: string, sessionId: string): string {
  const usage: Record<string, unknown> = {
    input_tokens: e.in,
    output_tokens: e.out,
    cache_read_input_tokens: e.read,
    cache_creation_input_tokens: e.w5m + e.w1h,
    cache_creation: {
      ephemeral_5m_input_tokens: e.w5m,
      ephemeral_1h_input_tokens: e.w1h,
    },
  };
  if (e.fast) usage.speed = 'fast';
  const line: Record<string, unknown> = {
    type: 'assistant',
    timestamp: new Date(e.ts).toISOString(),
    cwd,
    sessionId,
    requestId: d.id('req_', 22),
    message: {
      id: d.id('msg_', 24),
      model: e.model,
      stop_reason: e.stop,
      content: e.tools.map((name) => ({ type: 'tool_use', name })),
      usage,
    },
  };
  if (e.sidechain) line.isSidechain = true;
  return JSON.stringify(line);
}

function compactLine(ts: number, sessionId: string): string {
  return JSON.stringify({
    type: 'user',
    isCompactSummary: true,
    timestamp: new Date(ts).toISOString(),
    sessionId,
  });
}

/** One coding session: a saw-toothed context, tool bursts, optional subagents. */
function genSession(
  d: Dice,
  startTs: number,
  cwd: string,
  endCap: number,
): { sessionId: string; lines: string[]; lastTs: number } {
  const sessionId = d.uuid();
  const primary = d.pick(MODELS);
  const fastMode = primary === 'claude-opus-4-8' && d.chance(0.15);
  const hasSubagents = d.chance(0.25);
  const n = Math.floor(8 + Math.pow(d.f(), 1.35) * 40);
  const burstAt = hasSubagents ? d.int(3, Math.max(4, n - 5)) : -1;
  const burstLen = hasSubagents ? d.int(3, 7) : 0;
  const compactAt = n > 26 ? Math.floor(n * 0.6) : -1;

  let ts = startTs;
  let ctx = 4000 + d.f() * 12000;
  const lines: string[] = [];

  for (let i = 0; i < n; i++) {
    ts += 12_000 + Math.pow(d.f(), 2) * 100_000;
    if (ts > endCap) break;
    if (i === compactAt) {
      lines.push(compactLine(ts, sessionId));
      ctx *= 0.3;
      ts += 8_000 + d.f() * 20_000;
    }
    const sidechain = i >= burstAt && i < burstAt + burstLen;
    const model = sidechain
      ? d.pick(SIDE_MODELS)
      : d.chance(0.78)
        ? primary
        : d.pick(MODELS);
    ctx = Math.min(185_000, ctx + 800 + d.f() * 3500);
    const outTier = d.f();
    const out =
      outTier < 0.45 ? d.int(60, 280) : outTier < 0.8 ? d.int(280, 1100) : d.int(1100, 4200);
    const usesTools = d.chance(0.65);
    const tools: string[] = [];
    if (usesTools) for (let k = d.int(1, 4); k > 0; k--) tools.push(d.pick(TOOLS));
    lines.push(
      entryLine(
        d,
        {
          ts,
          model,
          fast: fastMode && model === 'claude-opus-4-8',
          sidechain,
          in: d.chance(0.9) ? d.int(2, 28) : d.int(100, 800),
          out,
          read: Math.round(sidechain ? ctx * 0.25 : ctx),
          w5m: d.chance(0.5) ? d.int(800, 14_000) : 0,
          w1h: d.chance(0.08) ? d.int(800, 6_000) : 0,
          tools,
          stop: usesTools ? 'tool_use' : 'end_turn',
        },
        cwd,
        sessionId,
      ),
    );
  }
  return { sessionId, lines, lastTs: ts };
}

export interface GenSummary {
  root: string;
  files: number;
  lines: number;
  days: number;
}

/** Wipe + fill an arbitrary `projectsDir` from a seeded Dice and project mix. */
function fillProjects(
  d: Dice,
  projectsDir: string,
  projects: ReadonlyArray<readonly [string, number]>,
  days: number,
): { files: number; lines: number } {
  fs.rmSync(projectsDir, { recursive: true, force: true });
  fs.mkdirSync(projectsDir, { recursive: true });

  const now = Date.now();
  const endCap = now - 15 * 60_000; // history stops shortly before "now"
  const hours: ReadonlyArray<readonly [number, number]> = HOUR_W.map((w, h) => [h, w] as const);

  let files = 0;
  let lineCount = 0;
  const writeSession = (cwd: string, start: number): void => {
    const session = genSession(d, start, cwd, endCap);
    if (!session.lines.length) return;
    const dir = path.join(projectsDir, encodeProjectDir(cwd));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${session.sessionId}.jsonl`), session.lines.join('\n') + '\n');
    files++;
    lineCount += session.lines.length;
  };

  for (let back = days - 1; back >= 0; back--) {
    const day = new Date(now - back * 86_400_000);
    const dow = day.getDay();
    const weekend = dow === 0 ? 0.2 : dow === 6 ? 0.35 : 1;
    const ramp = 0.55 + 0.6 * ((days - 1 - back) / Math.max(1, days - 1));
    if (d.chance(dow === 0 ? 0.35 : dow === 6 ? 0.2 : 0.05)) continue; // day off
    const spike = d.chance(0.05) ? 2.2 : 1;
    const nSessions = Math.min(11, Math.round((3.4 + d.f() * 5.5) * weekend * ramp * spike));
    for (let s = 0; s < nSessions; s++) {
      const cwd = d.pick(projects);
      const startHour = d.pick(hours);
      const start = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        startHour,
        d.int(0, 59),
        d.int(0, 59),
      ).getTime();
      if (start > endCap) continue;
      writeSession(cwd, start);
    }
  }
  // a recent burst so "today" and the current 5h block read busy on camera,
  // whatever local hour the recording happens at
  for (let s = 0; s < 3; s++) {
    writeSession(d.pick(projects), now - (45 + d.f() * 255) * 60_000);
  }
  return { files, lines: lineCount };
}

/** Wipe + regenerate `<root>/.claude/projects`. Root must look demo-ish. */
export function generate(opts: { root?: string; days?: number; seed?: number } = {}): GenSummary {
  const root = opts.root ?? DEFAULT_ROOT;
  const days = opts.days ?? 75;
  const seed = opts.seed ?? 20260612;
  if (!path.basename(root).includes('ccmon-demo')) {
    throw new Error(`refusing to wipe ${root} — root dir name must contain "ccmon-demo"`);
  }
  const d = new Dice(mulberry32(seed));
  const { files, lines } = fillProjects(d, path.join(root, '.claude', 'projects'), PROJECTS, days);
  return { root, files, lines, days };
}

// ---- multi-account world --------------------------------------------------

interface DemoAccountSpec {
  /** display label (also the credential token suffix) */
  label: string;
  /** root dir name under the demo home — '.claude' is the default account */
  rootDirName: string;
  projects: ReadonlyArray<readonly [string, number]>;
  /** added to the base seed so each account's history differs */
  seedOffset: number;
  identity: {
    email: string;
    organization: string;
    /** PLAN_LABELS key, e.g. 'claude_max' */
    organizationType: string;
    /** resolved plan label shown on the card, e.g. 'max' */
    subscriptionType: string;
    /** e.g. 'default_claude_max_20x' → tier '20x' */
    rateLimitTier: string;
  };
}

/** The synthetic accounts the promo films — a believable personal + work split. */
export const DEMO_ACCOUNTS: ReadonlyArray<DemoAccountSpec> = [
  {
    label: 'personal',
    rootDirName: '.claude',
    projects: PERSONAL_PROJECTS,
    seedOffset: 0,
    identity: {
      email: 'sam@hey.com',
      organization: 'Personal',
      organizationType: 'claude_max',
      subscriptionType: 'max',
      rateLimitTier: 'default_claude_max_20x',
    },
  },
  {
    label: 'work',
    rootDirName: '.claude-work',
    projects: WORK_PROJECTS,
    seedOffset: 101,
    identity: {
      email: 'sam@northwind.dev',
      organization: 'Northwind Labs',
      organizationType: 'claude_max',
      subscriptionType: 'max',
      rateLimitTier: 'default_claude_max_5x',
    },
  },
];

/** Write the non-secret identity + (demo) credentials a Claude Code account root carries. */
function writeAccountIdentity(home: string, acct: DemoAccountSpec): void {
  const rootDir = path.join(home, acct.rootDirName);
  fs.mkdirSync(rootDir, { recursive: true });
  // The default ~/.claude account's config is the SIBLING ~/.claude.json;
  // every other root keeps its config inside itself (see accounts.ts).
  const configPath =
    acct.rootDirName === '.claude'
      ? path.join(home, '.claude.json')
      : path.join(rootDir, '.claude.json');
  fs.writeFileSync(
    configPath,
    JSON.stringify(
      {
        oauthAccount: {
          emailAddress: acct.identity.email,
          organizationName: acct.identity.organization,
          organizationType: acct.identity.organizationType,
        },
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(rootDir, '.credentials.json'),
    JSON.stringify(
      {
        claudeAiOauth: {
          accessToken: `demo-${acct.label}`,
          expiresAt: Date.now() + 365 * 86_400_000,
          subscriptionType: acct.identity.subscriptionType,
          rateLimitTier: acct.identity.rateLimitTier,
        },
      },
      null,
      2,
    ),
  );
}

/**
 * Build the full multi-account demo world under a throwaway home: every account
 * gets its own `<root>/projects` history plus identity + credentials, so the
 * accounts dashboard, per-account meters and cross-account headroom all render.
 * Live limits are supplied separately by the env-gated demoLimits() provider.
 */
export function generateAccounts(
  home: string,
  opts: { days?: number; seed?: number } = {},
): GenSummary[] {
  if (!path.basename(home).includes('ccmon-demo')) {
    throw new Error(`refusing to wipe ${home} — home dir name must contain "ccmon-demo"`);
  }
  const days = opts.days ?? 75;
  const baseSeed = opts.seed ?? 20260612;
  return DEMO_ACCOUNTS.map((acct) => {
    const rootDir = path.join(home, acct.rootDirName);
    const d = new Dice(mulberry32(baseSeed + acct.seedOffset));
    const { files, lines } = fillProjects(d, path.join(rootDir, 'projects'), acct.projects, days);
    writeAccountIdentity(home, acct);
    return { root: rootDir, files, lines, days };
  });
}

/** Every demo account's `<root>/projects` dir — used to scope all views to the full world. */
export const accountProjectDirs = (home: string): string[] =>
  DEMO_ACCOUNTS.map((a) => path.join(home, a.rootDirName, 'projects'));

// ---- live ticker ----------------------------------------------------------

/**
 * Appends realistic entries to two "active" sessions every ~2s so the feed
 * ticks, the titlebar live-dot lights up and today's numbers move on camera.
 * Returns a stop function.
 */
export function startLiveTicker(root: string = DEFAULT_ROOT, seed = 1): () => void {
  const d = new Dice(mulberry32(seed));
  // the ticker targets the default (personal) account root, so keep its live
  // sessions on personal projects for a consistent recent-activity feed
  const sessions = [
    { cwd: '/home/dev/oss/ccmon', model: 'claude-opus-4-8', id: d.uuid(), ctx: 28_000 },
    { cwd: '/home/dev/personal/homelab', model: 'claude-fable-5', id: d.uuid(), ctx: 9_000 },
  ];
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;

  const append = (): void => {
    if (stopped) return;
    const s = sessions[d.int(0, sessions.length - 1)];
    // modest contexts: at this cadence big cache reads would project an
    // absurd block burn — keep the on-camera burn rate plausible
    s.ctx = Math.min(45_000, s.ctx + d.int(300, 1_500));
    const dir = path.join(root, '.claude', 'projects', encodeProjectDir(s.cwd));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${s.id}.jsonl`);
    const usesTools = d.chance(0.7);
    const tools: string[] = [];
    if (usesTools) for (let k = d.int(1, 3); k > 0; k--) tools.push(d.pick(TOOLS));
    const spec: EntrySpec = {
      ts: Date.now(),
      model: d.chance(0.85) ? s.model : 'claude-haiku-4-5-20251001',
      fast: false,
      sidechain: false,
      in: d.int(2, 24),
      out: d.int(80, 1400),
      read: Math.round(s.ctx),
      w5m: d.chance(0.5) ? d.int(800, 9_000) : 0,
      w1h: 0,
      tools,
      stop: usesTools ? 'tool_use' : 'end_turn',
    };
    fs.appendFileSync(file, entryLine(d, spec, s.cwd, s.id) + '\n');
    if (d.chance(0.12)) {
      const side: EntrySpec = {
        ...spec,
        ts: Date.now() + 200,
        model: d.pick(SIDE_MODELS),
        sidechain: true,
        out: d.int(60, 500),
        read: Math.round(s.ctx * 0.2),
        tools: [],
        stop: 'end_turn',
      };
      fs.appendFileSync(file, entryLine(d, side, s.cwd, s.id) + '\n');
    }
    timer = setTimeout(append, 1_400 + d.f() * 1_200);
  };

  timer = setTimeout(append, 300);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}

// ---- validation through the real pipeline ---------------------------------

export async function selfCheck(
  projectsDir: string = path.join(DEFAULT_ROOT, '.claude', 'projects'),
  minEntries = 3000,
): Promise<void> {
  const jsonls: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.jsonl')) jsonls.push(p);
    }
  };
  walk(projectsDir);

  const keys = new Set<string>();
  const entries: UsageEntry[] = [];
  let compacts = 0;
  for (const file of jsonls) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((raw, i) => {
      if (!raw.trim()) return;
      const p = parseLine(raw, file, i);
      if (!p) throw new Error(`unparseable line ${file}:${i + 1}`);
      if (p.kind === 'compact') {
        compacts++;
        return;
      }
      if (p.kind !== 'entry') throw new Error(`unexpected ${p.kind} in ${file}`);
      if (keys.has(p.key)) throw new Error(`duplicate dedupe key ${p.key}`);
      keys.add(p.key);
      const { kind: _kind, ...entry } = p;
      entries.push(entry);
    });
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-promo-pricing-'));
  const engine = await createPricingEngine({
    cacheDir: tmp,
    offline: true,
    overrides: {},
    archive: new PricingArchive(tmp),
  });
  const byModel = new Map<string, { cost: number; n: number }>();
  let total = 0;
  for (const e of entries) {
    const c = costForMode(e, 'auto', engine);
    total += c;
    const m = byModel.get(e.model) ?? { cost: 0, n: 0 };
    m.cost += c;
    m.n++;
    byModel.set(e.model, m);
  }

  const dates = entries.map((e) => e.dateKey).sort();
  console.log(`[demo-data] ${jsonls.length} files, ${entries.length} entries, ${compacts} compactions`);
  console.log(`[demo-data] ${dates[0]} → ${dates[dates.length - 1]}, total $${total.toFixed(2)}`);
  for (const [model, m] of [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost)) {
    console.log(`[demo-data]   ${model.padEnd(28)} ${String(m.n).padStart(6)} entries  $${m.cost.toFixed(2)}`);
    if (m.cost === 0) throw new Error(`model ${model} priced at $0 — not in the bundled snapshot?`);
  }
  if (entries.length < minEntries) throw new Error('suspiciously few entries generated');
}

/** Validate every account tree parses and carries a distinct, non-empty identity. */
export async function selfCheckAccounts(home: string): Promise<void> {
  const emails = new Set<string>();
  for (const acct of DEMO_ACCOUNTS) {
    const rootDir = path.join(home, acct.rootDirName);
    await selfCheck(path.join(rootDir, 'projects'), 1500);
    const configPath =
      acct.rootDirName === '.claude'
        ? path.join(home, '.claude.json')
        : path.join(rootDir, '.claude.json');
    const cfg = readJsonFile<{ oauthAccount?: { emailAddress?: string } }>(configPath);
    const email = cfg?.oauthAccount?.emailAddress ?? '';
    if (!email) throw new Error(`account ${acct.label} has no email in ${configPath}`);
    if (emails.has(email)) throw new Error(`account ${acct.label} reuses email ${email}`);
    emails.add(email);
    if (!fs.existsSync(path.join(rootDir, '.credentials.json'))) {
      throw new Error(`account ${acct.label} missing .credentials.json`);
    }
    console.log(`[demo-data]   account ${acct.label.padEnd(10)} ${email}`);
  }
}

function readJsonFile<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

// ---- CLI ------------------------------------------------------------------

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const root = arg('root') ?? DEFAULT_ROOT;
  if (process.argv.includes('--live')) {
    console.log(`[demo-data] live ticker → ${root} (ctrl-c to stop)`);
    const stop = startLiveTicker(root, Number(arg('seed') ?? 1));
    process.on('SIGINT', () => {
      stop();
      process.exit(0);
    });
    process.on('SIGTERM', () => {
      stop();
      process.exit(0);
    });
    return;
  }
  const days = Number(arg('days') ?? 75);
  const seed = Number(arg('seed') ?? 20260612);
  if (process.argv.includes('--accounts')) {
    if (!process.argv.includes('--check')) {
      const sums = generateAccounts(root, { days, seed });
      for (const s of sums) {
        console.log(`[demo-data] ${path.basename(s.root).padEnd(14)} ${s.files} files, ${s.lines} lines`);
      }
    }
    await selfCheckAccounts(root);
    return;
  }
  if (!process.argv.includes('--check')) {
    const sum = generate({ root, days, seed });
    console.log(`[demo-data] generated ${sum.files} session files (${sum.lines} lines) in ${sum.root}`);
  }
  await selfCheck(path.join(root, '.claude', 'projects'));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
