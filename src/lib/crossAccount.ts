/**
 * @file crossAccount.ts
 * @brief Cross-account headroom advice — when one account is capping and another has room.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import type { AccountsMap, LimitsMap } from '../../shared/types';

/**
 * ccmon polls every account's live limits, so it uniquely knows when the
 * account you're working on is about to cap while another sits idle. This
 * derive turns that into a concrete nudge: "personal session 96% · work 12% —
 * continue on work", plus the canonical `claude-cross-resume` command. It is
 * pure (no IPC, no DOM): inputs are the accounts + limits maps already in the
 * store. The user runs their own wrapper — ccmon never moves or launches a
 * session itself.
 */

export type LimitKind = 'session' | 'week';

export interface CrossAccountAdvice {
  /** which window triggered the advice */
  kind: LimitKind;
  /** the capping account's `<root>/projects` dir, and its utilization */
  fromDir: string;
  fromPct: number;
  /** the account with headroom (must have a stored login to resume) */
  toDir: string;
  toPct: number;
}

/** Thresholds — tuned to nudge only when the move is clearly worth it. */
export const ADVICE = {
  /** the binding account must be at least this utilized to bother */
  HIGH: 80,
  /** the alternative must be at least this many points lower */
  GAP: 25,
  /** ...and itself below this, i.e. genuinely have room */
  ROOM: 70,
} as const;

const WINDOW_PCT: Record<LimitKind, (limits: LimitsMap, dir: string) => number | null> = {
  session: (l, d) => {
    const r = l[d];
    return r?.ok ? (r.session?.pct ?? null) : null;
  },
  week: (l, d) => {
    const r = l[d];
    return r?.ok ? (r.week?.pct ?? null) : null;
  },
};

interface Candidate {
  dir: string;
  pct: number;
  hasLogin: boolean;
}

function candidates(accounts: AccountsMap, limits: LimitsMap, kind: LimitKind): Candidate[] {
  const out: Candidate[] = [];
  for (const dir of Object.keys(limits)) {
    const pct = WINDOW_PCT[kind](limits, dir);
    if (pct == null) continue;
    out.push({ dir, pct, hasLogin: accounts[dir]?.hasCredentials ?? false });
  }
  return out;
}

function adviceForKind(
  accounts: AccountsMap,
  limits: LimitsMap,
  kind: LimitKind,
): CrossAccountAdvice | null {
  const cands = candidates(accounts, limits, kind);
  if (cands.length < 2) return null;
  // the account about to cap…
  const from = cands.reduce((a, b) => (b.pct > a.pct ? b : a));
  // …and the account with the most room that can actually take the session
  const alt = cands
    .filter((c) => c.dir !== from.dir && c.hasLogin)
    .reduce<Candidate | null>((a, b) => (a == null || b.pct < a.pct ? b : a), null);
  if (!alt) return null;
  if (from.pct < ADVICE.HIGH) return null;
  if (alt.pct >= ADVICE.ROOM) return null;
  if (from.pct - alt.pct < ADVICE.GAP) return null;
  return { kind, fromDir: from.dir, fromPct: from.pct, toDir: alt.dir, toPct: alt.pct };
}

/**
 * Cross-account advice across both windows, most urgent first (the session
 * window caps faster than the weekly one, so it leads on a tie). Empty when no
 * account is close enough to a cap or no other account has room.
 */
export function crossAccountAdvice(
  accounts: AccountsMap,
  limits: LimitsMap,
): CrossAccountAdvice[] {
  const out: CrossAccountAdvice[] = [];
  for (const kind of ['session', 'week'] as const) {
    const a = adviceForKind(accounts, limits, kind);
    if (a) out.push(a);
  }
  return out.sort((a, b) => b.fromPct - a.fromPct);
}

/** `<root>/projects` → the account root (config) dir Claude Code reads. */
export const accountRoot = (projectDir: string): string =>
  projectDir.replace(/[\\/]projects[\\/]?$/, '');

const needsQuote = (s: string) => /[^A-Za-z0-9_./-]/.test(s);
const sh = (s: string) => (needsQuote(s) ? `"${s.replace(/(["$`\\])/g, '\\$1')}"` : s);

/**
 * The canonical, always-available resume command (mirrors the user's
 * `claude-cross-resume` helper): copy a session into the other account's root
 * and relaunch it there. ccmon emits this for the user to run; it never runs
 * it. `sessionId` is optional so the command can be shown before a specific
 * session is picked.
 */
export function crossResumeCommand(fromDir: string, toDir: string, sessionId?: string): string {
  const from = sh(accountRoot(fromDir));
  const to = sh(accountRoot(toDir));
  return `claude-cross-resume ${from} ${to} ${sessionId ?? '<session-id>'}`;
}
