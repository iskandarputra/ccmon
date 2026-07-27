/**
 * @file DeepseekConnect.tsx
 * @brief Connect / disconnect control for the DeepSeek API key — paste, or
 *        adopt one detected in the environment.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import './deepseek.css';
import { useState } from 'react';
import { useUsageStore } from '../../store/useUsageStore';

/**
 * DeepSeek has no OAuth (docs/v2-spec.md §5.7), so this is deliberately NOT
 * shaped like `<LoginPrompt/>`: there is no browser round-trip and no code to
 * paste back, just a key. The key goes one way — into main, which verifies it
 * against the balance endpoint before storing it — and only a masked tail
 * ever comes back.
 */
export function DeepseekConnect() {
  const auth = useUsageStore((s) => s.deepseekAuth);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [open, setOpen] = useState(false);

  async function connect(pasted?: string) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await window.ccmon?.connectDeepseek(pasted);
      if (r?.ok) {
        setKey('');
        setOpen(false);
        return; // the auth push re-renders this into the connected state
      }
      setError(r?.error || 'could not connect');
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await window.ccmon?.disconnectDeepseek();
      if (!r?.ok) setError(r?.error || 'could not disconnect');
    } finally {
      setBusy(false);
    }
  }

  // ---- connected with a key the user saved --------------------------------
  if (auth?.connected && auth.source === 'stored') {
    return (
      <div className="ds-connect">
        <span className="ds-status is-on">
          <i className="ds-dot" />
          connected · <code>{auth.hint}</code>
        </span>
        {!auth.encrypted && (
          <span
            className="ds-warn"
            title="No OS keyring was available, so the key is stored unencrypted (file mode 0600)."
          >
            stored unencrypted
          </span>
        )}
        <button type="button" className="ds-link" onClick={disconnect} disabled={busy}>
          {busy ? 'disconnecting…' : 'disconnect'}
        </button>
        {error && <span className="ds-err" title={error}>{error}</span>}
      </div>
    );
  }

  // ---- a key exists in the environment but was never saved ----------------
  if (auth?.connected && auth.source === 'env') {
    return (
      <div className="ds-connect">
        <span className="ds-status is-on">
          <i className="ds-dot" />
          using <code>{auth.hint}</code> from your environment
        </span>
        <button type="button" className="ds-btn" onClick={() => connect()} disabled={busy}>
          {busy ? 'saving…' : 'save it'}
        </button>
        <span className="ds-note">
          saving stores it encrypted so the balance keeps working when ccmon starts without that
          shell
        </span>
        {error && <span className="ds-err" title={error}>{error}</span>}
      </div>
    );
  }

  // ---- nothing configured -------------------------------------------------
  if (!open) {
    return (
      <div className="ds-connect">
        <button type="button" className="ds-btn" onClick={() => setOpen(true)}>
          connect deepseek
        </button>
        <span className="ds-note">read-only — ccmon only reads your balance</span>
      </div>
    );
  }

  return (
    <div className="ds-connect is-open">
      <div className="ds-row">
        <input
          className="ds-input"
          type="password"
          value={key}
          spellCheck={false}
          autoComplete="off"
          placeholder="sk-…"
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void connect(key)}
        />
        <button
          type="button"
          className="ds-btn"
          onClick={() => connect(key)}
          disabled={busy || !key.trim()}
        >
          {busy ? 'checking…' : 'connect'}
        </button>
        <button type="button" className="ds-link" onClick={() => setOpen(false)} disabled={busy}>
          cancel
        </button>
      </div>
      <span className="ds-note">
        create one at{' '}
        <button
          type="button"
          className="ds-extlink"
          onClick={() => window.ccmon?.openUrl('https://platform.deepseek.com/api_keys')}
        >
          platform.deepseek.com/api_keys
        </button>
        {' '}· the key is verified, then stored encrypted on this machine
      </span>
      {error && <span className="ds-err" title={error}>{error}</span>}
    </div>
  );
}
