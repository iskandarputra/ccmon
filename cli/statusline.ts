/**
 * @file statusline.ts
 * @brief Compact one-line usage summary for the Claude Code statusline hook.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * Pure formatting — the caller supplies the snapshot and the hook payload, so
 * this is unit-testable without a scan or a live Claude Code.
 */

import { compactTokens, humanDuration, money } from '../electron/services/status-text';
import type { Snapshot } from '../shared/types';

export { humanDuration };

/**
 * The subset of the Claude Code statusline hook payload this reads. Every field
 * is optional on purpose: the hook contract has grown over releases, and the
 * command is also useful when run by hand with no stdin at all.
 */
export interface HookPayload {
  session_id?: string;
  model?: { id?: string; display_name?: string };
  workspace?: { current_dir?: string; project_dir?: string };
  cwd?: string;
  /** newer Claude Code builds report live context usage */
  context_window?: { used_tokens?: number; max_tokens?: number };
}

/** Parse the hook payload; anything unusable degrades to an empty payload. */
export function parseHookPayload(stdin: string): HookPayload {
  const trimmed = stdin.trim();
  if (!trimmed) return {};
  try {
    const v = JSON.parse(trimmed) as unknown;
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/**
 * Build the status line.
 *
 * Segments are dropped rather than shown empty, so a fresh install with no
 * active block still prints something meaningful. The session segment needs the
 * hook's `session_id` to find its row; run by hand without stdin it is omitted.
 */
export function formatStatusline(snap: Snapshot, hook: HookPayload, privacy = false): string {
  const parts: string[] = [];

  const model = hook.model?.display_name || hook.model?.id;
  if (model) parts.push(model);

  const spend: string[] = [];
  const session = hook.session_id ? snap.sessions.find((s) => s.id === hook.session_id) : undefined;
  if (session) spend.push(`${money(session.cost, privacy)} session`);
  spend.push(`${money(snap.today.cost, privacy)} today`);

  if (snap.block) {
    spend.push(
      `${money(snap.block.cost, privacy)} block (${humanDuration(snap.block.remainingMs)} left)`,
    );
  } else {
    spend.push('no active block');
  }
  parts.push(spend.join(' / '));

  if (snap.block?.burn) {
    parts.push(`${money(snap.block.burn.costPerHour, privacy)}/hr ${snap.block.burn.level}`);
  }

  // Prefer Claude Code's own context accounting when the hook provides it —
  // it sees the live window, while ccmon can only infer from the transcript.
  const used = hook.context_window?.used_tokens;
  const max = hook.context_window?.max_tokens;
  if (typeof used === 'number' && typeof max === 'number' && max > 0) {
    parts.push(`ctx ${compactTokens(used)} (${Math.round((used / max) * 100)}%)`);
  } else if (session?.context) {
    parts.push(
      `ctx ${compactTokens(session.context.tokens)} (${Math.round(session.context.pct)}%)`,
    );
  }

  // A quota reset in the future is the single most actionable thing to surface.
  const reset = snap.block?.usageLimitResetTs ?? snap.usageLimitResetTs;
  if (reset && reset > snap.generatedAt) {
    parts.push(`limit resets in ${humanDuration(reset - snap.generatedAt)}`);
  }

  return parts.join(' | ');
}
