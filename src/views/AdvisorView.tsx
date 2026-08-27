/**
 * @file AdvisorView.tsx
 * @brief AI usage advisor — a chat over your usage AGGREGATES, answered by the
 *        Claude API using your Claude Code login. No transcripts ever leave.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import './advisor.css';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Panel } from '../components/ui/Panel';
import { Hint } from '../components/ui/Hint';
import { Markdown } from '../components/ui/Markdown';
import { useUsageStore } from '../store/useUsageStore';
import { sourceLabel } from '../lib/format';
import type { AdvisorMessage } from '../../shared/types';

interface Suggestion {
  text: string;
  glyph: ReactNode;
}

const SUGGESTIONS: Suggestion[] = [
  {
    text: 'Where is my money going?',
    glyph: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5v9M14.5 9.5c0-1.1-1.1-1.8-2.5-1.8s-2.5.7-2.5 1.7 1 1.5 2.5 1.8 2.5.8 2.5 1.9-1.1 1.7-2.5 1.7-2.5-.7-2.5-1.8" />
      </>
    ),
  },
  {
    text: 'How can I cut my cost without losing much?',
    glyph: (
      <>
        <circle cx="6.5" cy="7" r="2.5" />
        <circle cx="6.5" cy="17" r="2.5" />
        <line x1="20" y1="5" x2="8.5" y2="15.5" />
        <line x1="20" y1="19" x2="8.5" y2="8.5" />
      </>
    ),
  },
  {
    text: 'Am I about to hit a plan limit?',
    glyph: (
      <>
        <path d="M3.5 13a8.5 8.5 0 0 1 17 0" />
        <line x1="12" y1="13" x2="16" y2="9" />
        <line x1="3.5" y1="13" x2="5" y2="13" />
        <line x1="19" y1="13" x2="20.5" y2="13" />
      </>
    ),
  },
  {
    text: 'Is my prompt caching working well?',
    glyph: (
      <>
        <ellipse cx="12" cy="6.5" rx="7.5" ry="3" />
        <path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11" />
        <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
      </>
    ),
  },
];

interface ChatTurn extends AdvisorMessage {
  /** marks an assistant turn that is actually an error notice */
  error?: boolean;
}

/** small inline SVG wrapper so all glyphs share stroke styling */
function Glyph({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** the assistant's spark avatar, reused for both replies and the typing state */
const AVATAR = (
  <span className="adv-avatar" aria-hidden>
    <Glyph className="adv-avatar-icon">
      <path d="M12 4l1.3 3.9L17.2 9 13.3 10.3 12 14.2 10.7 10.3 6.8 9l3.9-1.1z" />
    </Glyph>
  </span>
);

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
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // accounts whose login we can actually spend a request on, ordered by
  // headroom (lowest session utilization first) so the default avoids a capped
  // account — the request shares that account's subscription rate limit.
  const candidates = useMemo(() => {
    const sessionPct = (d: string) => {
      const r = limits[d];
      return r?.ok ? (r.session?.pct ?? null) : null;
    };
    return (
      sourceDirs
        // Tool first, THEN credentials. A Codex account has credentials, but
        // they are an OpenAI token — the advisor POSTs the Anthropic Messages
        // API with the stored Claude Code login, so offering one would spend a
        // request on a guaranteed 401. The compiler cannot catch this: it is a
        // filter, not a type error.
        .filter((d) => accounts[d]?.tool === 'claude' && accounts[d]?.hasCredentials)
        .map((dir) => ({ dir, pct: sessionPct(dir) }))
        .sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999))
    );
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

  // auto-grow the composer up to a comfortable cap
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [draft]);

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
    <div className="grid adv-grid">
      <div className="g12 adv-col">
        <Panel
          className="adv-panel"
          title={
            <>
              usage advisor{' '}
              <Hint label="how this works">
                Asks a Claude model about a privacy-preserving summary of your usage — totals,
                per-model and per-project spend, cache stats, tool counts, and live plan limits.
                Your transcripts, prompts, and code never leave your machine. It reuses your Claude
                Code login; if it's expired, sign in from the accounts view.
              </Hint>
            </>
          }
          right={
            <span className="adv-meta">
              {turns.length > 0 && (
                <button
                  type="button"
                  className="adv-newchat"
                  onClick={() => setTurns([])}
                  disabled={busy}
                  title="start a new conversation"
                >
                  <Glyph className="adv-newchat-icon">
                    <path d="M12 5v14M5 12h14" />
                  </Glyph>
                  new chat
                </button>
              )}
              {candidates.length > 1 && (
                <label
                  className="adv-account"
                  title="which account's Claude Code login spends this request — pick one with headroom to avoid rate limits"
                >
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
            <div className="adv-wait">
              <span className="adv-wait-dot" />
              waiting for the first scan to finish…
            </div>
          ) : (
            <div className="adv-shell">
              <div className="adv-scroll" ref={scrollRef}>
                {turns.length === 0 ? (
                  <div className="adv-intro">
                    <div className="adv-hero">
                      <Glyph className="adv-hero-icon">
                        <path d="M12 3l1.6 4.8L18.4 9 13.6 10.6 12 15.4 10.4 10.6 5.6 9l4.8-1.2z" />
                        <circle cx="18" cy="17" r="1.3" />
                        <circle cx="6.5" cy="16" r="1" />
                      </Glyph>
                      <h2 className="adv-hero-title">How can I help with your usage?</h2>
                      <p className="adv-hero-sub">
                        Ask about your spend, cost drivers, cache efficiency, or how close you are
                        to a plan cap.
                      </p>
                    </div>
                    <div className="adv-suggest">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s.text}
                          type="button"
                          className="adv-chip"
                          onClick={() => ask(s.text)}
                        >
                          <Glyph className="adv-chip-icon">{s.glyph}</Glyph>
                          <span>{s.text}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="adv-thread">
                    {turns.map((t, i) => (
                      <div
                        key={i}
                        className={`adv-turn adv-${t.role}${t.error ? ' is-error' : ''}`}
                      >
                        {t.role === 'assistant' && AVATAR}
                        <div className="adv-bubble">
                          {t.role === 'assistant' && !t.error ? (
                            <Markdown content={t.content} />
                          ) : (
                            t.content
                          )}
                        </div>
                      </div>
                    ))}
                    {busy && (
                      <div className="adv-turn adv-assistant">
                        {AVATAR}
                        <div className="adv-bubble adv-thinking">
                          <span className="adv-dot" />
                          <span className="adv-dot" />
                          <span className="adv-dot" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <form
                className="adv-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(draft);
                }}
              >
                <textarea
                  ref={inputRef}
                  className="adv-field"
                  value={draft}
                  rows={1}
                  placeholder="Ask about your usage…"
                  spellCheck={false}
                  disabled={busy}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void ask(draft);
                    }
                  }}
                />
                <button
                  type="submit"
                  className="adv-send"
                  disabled={busy || !draft.trim()}
                  title="send (Enter)"
                >
                  <Glyph className="adv-send-icon">
                    <path d="M5 12h13M12 5l7 7-7 7" />
                  </Glyph>
                </button>
              </form>
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
