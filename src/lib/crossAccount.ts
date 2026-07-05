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

export interface CrossTarget {
  /** a candidate account — its `<root>/projects` dir and utilization */
  dir: string;
  pct: number;
  /**
   * true when this account is clearly below its own cap AND a worthwhile gap
   * below the source — i.e. switching here genuinely buys headroom. false
   * targets are still valid to resume onto (the user asked for flexibility),
   * they just aren't a headroom win.
   */
  hasRoom: boolean;
}

export interface CrossAccountAdvice {
  /** which window this ranking is over */
  kind: LimitKind;
  /** the highest-utilization account's `<root>/projects` dir, and its pct */
  fromDir: string;
  fromPct: number;
  /**
   * true when the source is close enough to its cap (and the best target has
   * real room) that the move is genuinely worth nudging — drives the urgent
   * "capping" styling. false means this is an always-available manual switch.
   */
  urgent: boolean;
  /**
   * every other logged-in account, most headroom first. Always non-empty when
   * an advice is returned (there is at least one account to switch to).
   */
  targets: CrossTarget[];
  /** the single best target (= `targets[0]`), kept for one-pick callers */
  toDir: string;
  toPct: number;
}

/** Thresholds — govern the *urgency* signal, not whether advice is shown. */
export const ADVICE = {
  /** the source must be at least this utilized for the move to read as urgent */
  HIGH: 80,
  /** a target must be at least this many points lower to count as real room */
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
  // the highest-utilization account is the source we'd copy the session off…
  const from = cands.reduce((a, b) => (b.pct > a.pct ? b : a));
  // …and every other logged-in account is a valid target, ranked most-headroom
  // first. We no longer gate on the source being near a cap — the user can
  // cross-resume at any utilization — but we still flag which targets have
  // real room so the UI can nudge urgently only when it matters.
  const targets = cands
    .filter((c) => c.dir !== from.dir && c.hasLogin)
    .sort((a, b) => a.pct - b.pct)
    .map<CrossTarget>((c) => ({
      dir: c.dir,
      pct: c.pct,
      hasRoom: c.pct < ADVICE.ROOM && from.pct - c.pct >= ADVICE.GAP,
    }));
  if (targets.length === 0) return null;
  const best = targets[0];
  const urgent = from.pct >= ADVICE.HIGH && best.hasRoom;
  return {
    kind,
    fromDir: from.dir,
    fromPct: from.pct,
    urgent,
    targets,
    toDir: best.dir,
    toPct: best.pct,
  };
}

/**
 * Cross-account advice across both windows, highest-utilization first (the
 * session window caps faster than the weekly one, so it leads on a tie).
 * Always available when at least two accounts report limits and at least one
 * *other* account is logged in — so the resume command is there whenever you
 * want to switch, not only when a cap looms. Empty only when there's nowhere
 * to switch to (one account, or no other logged-in account).
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
