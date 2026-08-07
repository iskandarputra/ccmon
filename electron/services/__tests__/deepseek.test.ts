/**
 * @file deepseek.test.ts
 * @brief Unit tests for DeepSeek balance parsing, primary-currency choice,
 *        and the fetch's success / failure contracts (network mocked).
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchBalance, parseBalances, pickPrimary } from '../deepseek';

/** A Response-like with a json/text body + status for stubbing global fetch. */
const jsonResponse = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });

const CNY_BODY = {
  is_available: true,
  balance_infos: [
    {
      currency: 'CNY',
      total_balance: '110.00',
      granted_balance: '10.00',
      topped_up_balance: '100.00',
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseBalances', () => {
  it('parses the documented string-decimal shape', () => {
    expect(parseBalances(CNY_BODY.balance_infos)).toEqual([
      { currency: 'CNY', total: 110, granted: 10, toppedUp: 100 },
    ]);
  });

  it('accepts numeric amounts too — the API documents strings, but numbers are unambiguous', () => {
    const rows = parseBalances([{ currency: 'usd', total_balance: 41.2, granted_balance: 0 }]);
    expect(rows).toEqual([{ currency: 'USD', total: 41.2, granted: 0, toppedUp: 0 }]);
  });

  it('drops rows missing the load-bearing currency/total pair', () => {
    expect(
      parseBalances([
        { currency: 'USD' }, //             no total
        { total_balance: '5.00' }, //       no currency
        { currency: 'USD', total_balance: 'not-a-number' },
        { currency: 'USD', total_balance: '5.00' },
      ]),
    ).toEqual([{ currency: 'USD', total: 5, granted: 0, toppedUp: 0 }]);
  });

  it('tolerates a non-array (a shape change shows up as empty, not a throw)', () => {
    expect(parseBalances(undefined)).toEqual([]);
    expect(parseBalances({ currency: 'USD' })).toEqual([]);
  });
});

describe('pickPrimary', () => {
  const cny = { currency: 'CNY', total: 110, granted: 10, toppedUp: 100 };
  const usd = { currency: 'USD', total: 15, granted: 0, toppedUp: 15 };

  it('prefers USD so it lines up with every other number in the app', () => {
    expect(pickPrimary([cny, usd])).toBe(usd);
  });

  it('falls back to the first balance when there is no USD row', () => {
    expect(pickPrimary([cny])).toBe(cny);
  });

  it('is null for an empty set', () => {
    expect(pickPrimary([])).toBeNull();
  });
});

describe('fetchBalance', () => {
  it('sends the key as a bearer token and returns the parsed balance', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(CNY_BODY));
    vi.stubGlobal('fetch', fetchMock);

    const r = await fetchBalance('sk-test-key');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.isAvailable).toBe(true);
    expect(r.primary).toEqual({ currency: 'CNY', total: 110, granted: 10, toppedUp: 100 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.deepseek.com/user/balance');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test-key');
  });

  it('carries is_available: false through — the balance can be non-zero and still unusable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ ...CNY_BODY, is_available: false })),
    );
    const r = await fetchBalance('sk-test-key');
    expect(r.ok && r.isAvailable).toBe(false);
  });

  it('never hits the network without a key', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await fetchBalance('');
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('explains a rejected key rather than echoing a bare status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse('Unauthorized', 401)));
    const r = await fetchBalance('sk-bad');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/invalid or was revoked/);
    expect(r.status).toBe(401);
  });

  it('normalizes Retry-After into ms so the poller can honour it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse('slow down', 429, { 'retry-after': '30' })),
    );
    const r = await fetchBalance('sk-test-key');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.retryAfterMs).toBe(30_000);
    expect(r.error).toMatch(/rate limited/);
  });

  it('fails loudly when a 200 carries no recognizable balances', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ is_available: true })));
    const r = await fetchBalance('sk-test-key');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/response shape may have changed/);
  });

  it('reports a network failure instead of rejecting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const r = await fetchBalance('sk-test-key');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/network error/);
  });
});
