/**
 * @file LoginPrompt.tsx
 * @brief Inline re-login control — one-click silent refresh, with a browser
 *        paste-the-code fallback when the stored refresh token is dead.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import './loginprompt.css';
import { useState } from 'react';

interface LoginPromptProps {
  /** source dir of the account to re-authenticate */
  dir: string;
  /** button label in the idle state (default 'log in') */
  label?: string;
}

/**
 * Drives the two IPC steps of {@link window.ccmon.login}: a click first tries a
 * silent token refresh; if that needs the browser the OS browser is opened and
 * we reveal a code box to finish. On success the parent stops rendering this
 * (its limits flip to `ok`), so there's no explicit "done" state to show.
 */
export function LoginPrompt({ dir, label = 'log in' }: LoginPromptProps) {
  const [busy, setBusy] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string>();

  async function startLogin() {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await window.ccmon?.login(dir);
      if (!r) return setError('login unavailable');
      if (r.status === 'refreshed') return; // parent re-renders with live limits
      if (r.status === 'awaiting-code') return setAwaiting(true);
      setError(r.error);
    } finally {
      setBusy(false);
    }
  }

  async function finishLogin() {
    const value = code.trim();
    if (busy || !value) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await window.ccmon?.submitLoginCode(dir, value);
      if (r?.ok) {
        setAwaiting(false); // parent re-renders with live limits
        setCode('');
        return;
      }
      setError(r?.error || 'could not complete login');
    } finally {
      setBusy(false);
    }
  }

  if (!awaiting) {
    return (
      <div className="login-prompt">
        <button type="button" className="login-btn" onClick={startLogin} disabled={busy}>
          {busy ? 'signing in…' : label}
        </button>
        {error && (
          <span className="login-err" title={error}>
            {error}
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="login-prompt is-awaiting">
      <span className="login-hint">
        a browser opened — approve, then paste the code it shows below
      </span>
      <div className="login-row">
        <input
          className="login-code"
          type="text"
          value={code}
          spellCheck={false}
          autoComplete="off"
          placeholder="paste code here"
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void finishLogin()}
        />
        <button
          type="button"
          className="login-btn"
          onClick={finishLogin}
          disabled={busy || !code.trim()}
        >
          {busy ? 'finishing…' : 'finish'}
        </button>
        <button type="button" className="login-link" onClick={startLogin} disabled={busy}>
          reopen
        </button>
      </div>
      {error && (
        <span className="login-err" title={error}>
          {error}
        </span>
      )}
    </div>
  );
}
