/**
 * @file AdvisorDrawer.tsx
 * @brief Slide-over AI Advisor drawer with animated typing and live telemetry.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './advisordrawer.css';
import '../../views/advisor.css';
import { Markdown } from '../ui/Markdown';
import { useUsageStore } from '../../store/useUsageStore';
import { fmtUSD } from '../../lib/format';
import type { AdvisorMessage } from '../../../shared/types';

interface Suggestion {
  title: string;
  desc: string;
  prompt: string;
  glyph: ReactNode;
}

const SUGGESTIONS: Suggestion[] = [
  {
    title: 'Macro Tokenomics & Drivers',
    desc: 'Decompose primary cost drivers and unit economics ($/MTok)',
    prompt: 'Analyze my macro tokenomics & primary cost drivers',
    glyph: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5v9M14.5 9.5c0-1.1-1.1-1.8-2.5-1.8s-2.5.7-2.5 1.7 1 1.5 2.5 1.8 2.5.8 2.5 1.9-1.1 1.7-2.5 1.7-2.5-.7-2.5-1.8" />
      </>
    ),
  },
  {
    title: 'Zero-Loss Cost Playbook',
    desc: 'Targeted optimizations that preserve developer velocity',
    prompt: 'Formulate a zero-loss cost reduction playbook',
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
    title: 'Multi-Account Arbitrage',
    desc: 'Balance workload routing across accounts & plan limits',
    prompt: 'Multi-account headroom & rate-limit arbitrage',
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
    title: 'Cache & TTL Diagnostics',
    desc: 'Diagnose cache thrashing, 5m TTL penalties & compaction',
    prompt: 'Diagnose cache thrashing, TTL penalties & compaction efficiency',
    glyph: (
      <>
        <ellipse cx="12" cy="6.5" rx="7.5" ry="3" />
        <path d="M4.5 6.5v11c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-11" />
        <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
      </>
    ),
  },
];

const PROMPT_HINTS = [
  'Where did my spend go this week?',
  'How can I cut cost without losing reasoning quality?',
  'Is my 5-minute prompt cache TTL being thrashed?',
  'Which project has the highest subagent overhead?',
  'Am I about to hit my 5-hour rolling session limit?',
  'What would my spend be on Sonnet 4.6 or Haiku?',
];

interface ChatTurn extends AdvisorMessage {
  error?: boolean;
}

function Glyph({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
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

const AVATAR = (
  <span className="adv-avatar" aria-hidden>
    <Glyph className="adv-avatar-icon">
      <path d="M12 4l1.3 3.9L17.2 9 13.3 10.3 12 14.2 10.7 10.3 6.8 9l3.9-1.1z" />
    </Glyph>
  </span>
);

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      type="button"
      className={`adv-copy-btn ${copied ? 'is-copied' : ''}`}
      onClick={copy}
      title="Copy answer"
    >
      {copied ? (
        <>
          <Glyph className="adv-copy-icon">
            <polyline points="20 6 9 17 4 12" />
          </Glyph>
          <span>copied</span>
        </>
      ) : (
        <>
          <Glyph className="adv-copy-icon">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </Glyph>
          <span>copy</span>
        </>
      )}
    </button>
  );
}

interface AdvisorDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function AdvisorDrawer({ open, onClose }: AdvisorDrawerProps) {
  const snapshot = useUsageStore((s) => s.snapshot);
  const model = useUsageStore((s) => s.settings?.aiModel) ?? 'claude-sonnet-4-6';
  const accounts = useUsageStore((s) => s.accounts);
  const limits = useUsageStore((s) => s.limits);
  const sourceDirs = useUsageStore((s) => s.sourceDirs);
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [thinkingStage, setThinkingStage] = useState(0);
  const [account, setAccount] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Typewriter dynamic placeholder effect
  const [placeholderText, setPlaceholderText] = useState('');
  const [hintIdx, setHintIdx] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (draft.length > 0) return;
    const current = PROMPT_HINTS[hintIdx % PROMPT_HINTS.length];
    const speed = isDeleting ? 22 : 40;

    const timer = setTimeout(() => {
      if (!isDeleting) {
        if (placeholderText.length < current.length) {
          setPlaceholderText(current.slice(0, placeholderText.length + 1));
        } else {
          setTimeout(() => setIsDeleting(true), 2400);
        }
      } else {
        if (placeholderText.length > 0) {
          setPlaceholderText(current.slice(0, placeholderText.length - 1));
        } else {
          setIsDeleting(false);
          setHintIdx((i) => (i + 1) % PROMPT_HINTS.length);
        }
      }
    }, speed);

    return () => clearTimeout(timer);
  }, [draft, placeholderText, isDeleting, hintIdx]);

  useEffect(() => {
    if (!busy) {
      setThinkingStage(0);
      return;
    }
    const interval = setInterval(() => {
      setThinkingStage((s) => (s + 1) % 3);
    }, 1800);
    return () => clearInterval(interval);
  }, [busy]);

  const candidates = useMemo(() => {
    const sessionPct = (d: string) => {
      const r = limits[d];
      return r?.ok ? (r.session?.pct ?? null) : null;
    };
    return sourceDirs
      .filter((d) => accounts[d]?.tool === 'claude' && accounts[d]?.hasCredentials)
      .map((dir) => ({ dir, pct: sessionPct(dir) }))
      .sort((a, b) => (a.pct ?? 999) - (b.pct ?? 999));
  }, [sourceDirs, accounts, limits]);

  useEffect(() => {
    if (!candidates.some((c) => c.dir === account)) {
      setAccount(candidates[0]?.dir ?? null);
    }
  }, [candidates, account]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 150);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function ask(question: string) {
    const q = question.trim();
    if (!q || busy) return;
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

  const thinkingMessages = [
    'Decomposing aggregate tokenomics & unit rates…',
    'Evaluating prompt cache retention & TTL penalties…',
    'Synthesizing high-leverage optimization playbook…',
  ];

  return (
    <div className="adv-drawer-overlay" onClick={onClose}>
      <div className="adv-drawer" onClick={(e) => e.stopPropagation()}>
        <header className="adv-drawer-head">
          <div className="adv-drawer-title">
            <Glyph
              className="adv-avatar-icon"
              style={{ width: 16, height: 16, color: 'var(--amber)' }}
            >
              <path d="M12 4l1.3 3.9L17.2 9 13.3 10.3 12 14.2 10.7 10.3 6.8 9l3.9-1.1z" />
            </Glyph>
            <h3>AI Usage Advisor</h3>
            <span className="adv-live-tag">
              <span className="adv-live-radar" />
              {model}
            </span>
          </div>
          <button
            type="button"
            className="adv-drawer-close"
            onClick={onClose}
            aria-label="Close advisor"
          >
            ✕
          </button>
        </header>

        <div className="adv-drawer-body">
          {!snapshot ? (
            <div className="adv-wait">
              <span className="adv-wait-dot" />
              waiting for usage scan…
            </div>
          ) : (
            <div className="adv-shell" style={{ height: '100%' }}>
              <div className="adv-scroll" ref={scrollRef} style={{ maxHeight: 'none', flex: 1 }}>
                {turns.length === 0 ? (
                  <div className="adv-intro">
                    <div className="adv-live-ribbon">
                      <div className="adv-ribbon-pill is-glow" title="Prompt Cache Efficiency">
                        <span className="adv-ribbon-dot is-green" />
                        <span className="adv-ribbon-key">cache</span>
                        <span className="adv-ribbon-val">
                          {((snapshot.cache?.hitRate ?? 0) * 100).toFixed(0)}%
                        </span>
                        {snapshot.cache?.savedUSD ? (
                          <span className="adv-ribbon-sub">
                            ({fmtUSD(snapshot.cache.savedUSD)} saved)
                          </span>
                        ) : null}
                      </div>
                      <div className="adv-ribbon-pill" title="7-Day Spend Velocity">
                        <span className="adv-ribbon-dot is-amber" />
                        <span className="adv-ribbon-key">7d</span>
                        <span className="adv-ribbon-val">{fmtUSD(snapshot.week?.cost ?? 0)}</span>
                      </div>
                    </div>

                    <div className="adv-hero">
                      <div className="adv-hero-icon-wrap">
                        <div className="adv-hero-glow-ring" />
                        <Glyph className="adv-hero-icon">
                          <path d="M12 3l1.6 4.8L18.4 9 13.6 10.6 12 15.4 10.4 10.6 5.6 9l4.8-1.2z" />
                          <circle cx="18" cy="17" r="1.3" />
                          <circle cx="6.5" cy="16" r="1" />
                        </Glyph>
                      </div>
                      <h2 className="adv-hero-title" style={{ fontSize: '18px' }}>
                        Usage Intelligence
                      </h2>
                      <p className="adv-hero-sub">
                        Privacy-preserving queries over token economics and plan limits.
                      </p>
                    </div>

                    <div className="adv-suggest">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s.title}
                          type="button"
                          className="adv-chip"
                          onClick={() => ask(s.prompt)}
                        >
                          <div className="adv-chip-icon-box">
                            <Glyph className="adv-chip-icon">{s.glyph}</Glyph>
                          </div>
                          <div className="adv-chip-body">
                            <span className="adv-chip-title">{s.title}</span>
                            <span className="adv-chip-desc">{s.desc}</span>
                          </div>
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
                          {t.role === 'assistant' && !t.error && (
                            <div className="adv-bubble-actions">
                              <CopyButton text={t.content} />
                            </div>
                          )}
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
                        <div className="adv-bubble adv-thinking-box">
                          <div className="adv-thinking-header">
                            <span className="adv-thinking-wave">
                              <span className="adv-bar" />
                              <span className="adv-bar" />
                              <span className="adv-bar" />
                              <span className="adv-bar" />
                            </span>
                            <span className="adv-thinking-label">
                              {thinkingMessages[thinkingStage]}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <form
                className={`adv-composer ${busy ? 'is-busy' : ''}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  void ask(draft);
                }}
              >
                <div className="adv-composer-box">
                  <textarea
                    ref={inputRef}
                    className="adv-field"
                    value={draft}
                    rows={1}
                    placeholder={
                      placeholderText ? `Ask: "${placeholderText}"` : 'Ask about your usage…'
                    }
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
                  <div className="adv-composer-footer">
                    <span className="adv-composer-privacy">🔒 100% local aggregates</span>
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
                  </div>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
