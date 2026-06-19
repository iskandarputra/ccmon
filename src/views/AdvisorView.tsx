/**
 * @file AdvisorView.tsx
 * @brief AI usage advisor — a chat over your usage AGGREGATES, answered by the
 *        Claude API using your Claude Code login. No transcripts ever leave.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import './advisor.css';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Panel } from '../components/ui/Panel';
import { Hint } from '../components/ui/Hint';
import { useUsageStore } from '../store/useUsageStore';
import { sourceLabel } from '../lib/format';
import type { AdvisorMessage } from '../../shared/types';

const SUGGESTIONS = [
  'Where is my money going?',
  'How can I cut my cost without losing much?',
  'Am I about to hit a plan limit?',
  'Is my prompt caching working well?',
];

interface ChatTurn extends AdvisorMessage {
  /** marks an assistant turn that is actually an error notice */
  error?: boolean;
}

export function AdvisorView() {
  const snapshot = useUsageStore((s) => s.snapshot);
  const model = useUsageStore((s) => s.settings?.aiModel) ?? 'claude-sonnet-4-6';
  const accounts = useUsageStore((s) => s.accounts);
  const limits = useUsageStore((s) => s.limits);
  const sourceDirs = useUsageStore((s) => s.sourceDirs);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // accounts whose login we can actually spend a request on, ordered by
  // headroom (lowest session utilization first) so the default avoids a capped
  // account — the request shares that account's subscription rate limit.
  const candidates = useMemo(() => {
    const sessionPct = (d: string) => {
      const r = limits[d];
      return r?.ok ? r.session?.pct ?? null : null;
    };
    return sourceDirs
      .filter((d) => accounts[d]?.hasCredentials)
      .map((dir) => ({ dir, pct: sessionPct(dir) }))
      .sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));
  }, [sourceDirs, accounts, limits]);

  // default/repair the selection: pick the most-headroom account once data
  // arrives, or when the current choice stops being valid (login removed)
  useEffect(() => {
    if (!candidates.some((c) => c.dir === account)) {
      setAccount(candidates[0]?.dir ?? null);
    }
  }, [candidates, account]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    // history sent = the conversation BEFORE this question, errors stripped
    const history: AdvisorMessage[] = turns
      .filter((t) => !t.error)
      .map(({ role, content }) => ({ role, content }));
    setTurns((t) => [...t, { role: 'user', content: q }]);
    setDraft('');
    setBusy(true);
    const r = await window.ccmon?.askAdvisor(q, history, account ?? undefined);
    setBusy(false);
    if (!r) {
      setTurns((t) => [...t, { role: 'assistant', content: 'advisor unavailable', error: true }]);
      return;
    }
    setTurns((t) =>
      r.ok
        ? [...t, { role: 'assistant', content: r.answer }]
        : [...t, { role: 'assistant', content: r.error, error: true }],
    );
  }

  return (
    <div className="grid">
      <div className="g12">
        <Panel
          title={
            <>
              usage advisor{' '}
              <Hint label="how this works">
                Asks a Claude model about a privacy-preserving summary of your
                usage — totals, per-model and per-project spend, cache stats,
                tool counts, and live plan limits. Your transcripts, prompts,
                and code never leave your machine. It reuses your Claude Code
                login; if it's expired, sign in from the accounts view.
              </Hint>
            </>
          }
          right={
            <span className="adv-meta">
              {candidates.length > 1 && (
                <label className="adv-account" title="which account's Claude Code login spends this request — pick one with headroom to avoid rate limits">
                  <span className="adv-account-cap" aria-hidden>
                    acct
                  </span>
                  <select
                    value={account ?? ''}
                    disabled={busy}
                    onChange={(e) => setAccount(e.target.value)}
                  >
                    {candidates.map((c) => (
                      <option key={c.dir} value={c.dir}>
                        {sourceLabel(c.dir)}
                        {c.pct != null ? ` · ${Math.round(c.pct)}%` : ''}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <span className="panel-note">aggregates only · {model}</span>
            </span>
          }
        >
          {!snapshot ? (
            <div className="adv-empty">waiting for the first scan to finish…</div>
          ) : (
            <>
              <div className="adv-scroll" ref={scrollRef}>
                {turns.length === 0 && (
                  <div className="adv-intro">
                    <p className="adv-intro-lead">
                      Ask about your spend, cost drivers, cache efficiency, or how
                      close you are to a plan cap.
                    </p>
                    <div className="adv-suggest">
                      {SUGGESTIONS.map((s) => (
                        <button key={s} type="button" className="adv-chip" onClick={() => ask(s)}>
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {turns.map((t, i) => (
                  <div key={i} className={`adv-turn adv-${t.role}${t.error ? ' is-error' : ''}`}>
                    <span className="adv-role">{t.role === 'user' ? 'you' : 'advisor'}</span>
                    <div className="adv-bubble">{t.content}</div>
                  </div>
                ))}
                {busy && (
                  <div className="adv-turn adv-assistant">
                    <span className="adv-role">advisor</span>
                    <div className="adv-bubble adv-thinking">thinking…</div>
                  </div>
                )}
              </div>

              <form
                className="adv-input"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(draft);
                }}
              >
                <input
                  type="text"
                  value={draft}
                  placeholder="ask about your usage…"
                  spellCheck={false}
                  disabled={busy}
                  onChange={(e) => setDraft(e.target.value)}
                />
                <button type="submit" disabled={busy || !draft.trim()}>
                  {busy ? '…' : 'ask'}
                </button>
              </form>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}
