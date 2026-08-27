/**
 * @file currency.test.ts
 * @brief Unit tests for the two-leg exchange-rate service and its keep-last-good behaviour.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * The behaviour worth pinning is partial failure. Two independent upstreams
 * (fiat and crypto) are fetched in parallel, and the contract is that ONE
 * failing must never take out the other's rates or the previously cached
 * table — a display currency silently reverting to USD mid-session, or worse
 * converting at a stale-but-unlabelled rate, is the failure mode this guards.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CurrencyService } from '../currency';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-currency-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

const json = (body: unknown, ok = true, status = 200) =>
  ({ ok, status, json: () => Promise.resolve(body) }) as Response;

const FIAT_OK = { result: 'success', rates: { EUR: 0.92, GBP: 0.79, USD: 1 } };
const CRYPTO_OK = { bitcoin: { usd: 100000 }, ethereum: { usd: 4000 } };

/** Route by URL so the two legs can succeed and fail independently. */
function stubFetch(fiat: () => Promise<Response>, crypto: () => Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string) => (url.includes('coingecko') ? crypto() : fiat())),
  );
}

describe('CurrencyService — happy path', () => {
  it('merges both legs into one table', async () => {
    stubFetch(
      () => Promise.resolve(json(FIAT_OK)),
      () => Promise.resolve(json(CRYPTO_OK)),
    );
    const s = await new CurrencyService(tmp).refresh();
    expect(s.source).toBe('live');
    expect(s.lastError).toBeNull();
    expect(s.rates.EUR).toBe(0.92);
    // crypto is stored as units-per-USD, i.e. the inverse of the coin price
    expect(s.rates.BTC).toBeCloseTo(1 / 100000);
  });

  it('persists to disk and reloads as a cache on next construction', async () => {
    stubFetch(
      () => Promise.resolve(json(FIAT_OK)),
      () => Promise.resolve(json(CRYPTO_OK)),
    );
    await new CurrencyService(tmp).refresh();

    const reloaded = new CurrencyService(tmp).get();
    expect(reloaded.source).toBe('cache');
    expect(reloaded.rates.EUR).toBe(0.92);
    expect(reloaded.fetchedAt).toBeGreaterThan(0);
  });

  it('drops non-numeric and non-positive rates from the response', async () => {
    stubFetch(
      () =>
        Promise.resolve(
          json({ result: 'success', rates: { EUR: 0.92, BAD: 'x', ZERO: 0, NEG: -1 } }),
        ),
      () => Promise.resolve(json(CRYPTO_OK)),
    );
    const s = await new CurrencyService(tmp).refresh();
    expect(s.rates.EUR).toBe(0.92);
    expect(s.rates.BAD).toBeUndefined();
    expect(s.rates.ZERO).toBeUndefined();
    expect(s.rates.NEG).toBeUndefined();
  });
});

describe('CurrencyService — partial failure keeps last good', () => {
  it('keeps fiat rates when the crypto leg fails, and says which failed', async () => {
    stubFetch(
      () => Promise.resolve(json(FIAT_OK)),
      () => Promise.reject(new Error('502 bad gateway')),
    );
    const s = await new CurrencyService(tmp).refresh();
    expect(s.rates.EUR).toBe(0.92); // fiat survived
    expect(s.source).toBe('live');
    expect(s.lastError).toContain('crypto');
    expect(s.lastError).toContain('502 bad gateway');
    expect(s.lastError).not.toContain('fiat (');
  });

  it('keeps crypto rates when the fiat leg fails', async () => {
    stubFetch(
      () => Promise.reject(new Error('dns failure')),
      () => Promise.resolve(json(CRYPTO_OK)),
    );
    const s = await new CurrencyService(tmp).refresh();
    expect(s.rates.BTC).toBeCloseTo(1 / 100000);
    expect(s.lastError).toContain('fiat');
  });

  /** The important one: a total outage must not wipe the table. */
  it('preserves the previous rates when BOTH legs fail', async () => {
    stubFetch(
      () => Promise.resolve(json(FIAT_OK)),
      () => Promise.resolve(json(CRYPTO_OK)),
    );
    const svc = new CurrencyService(tmp);
    await svc.refresh();

    stubFetch(
      () => Promise.reject(new Error('offline')),
      () => Promise.reject(new Error('offline')),
    );
    const s = await svc.refresh();
    expect(s.rates.EUR).toBe(0.92); // still there
    expect(s.lastError).toContain('fiat');
    expect(s.lastError).toContain('crypto');
  });

  it('reports an unsuccessful fiat payload as a failure, not empty rates', async () => {
    stubFetch(
      () => Promise.resolve(json({ result: 'error', rates: {} })),
      () => Promise.resolve(json(CRYPTO_OK)),
    );
    const s = await new CurrencyService(tmp).refresh();
    expect(s.lastError).toContain('fiat');
    expect(s.rates.BTC).toBeDefined();
  });

  it('treats a non-2xx response as a failure of that leg', async () => {
    stubFetch(
      () => Promise.resolve(json({}, false, 503)),
      () => Promise.resolve(json(CRYPTO_OK)),
    );
    const s = await new CurrencyService(tmp).refresh();
    expect(s.lastError).toContain('HTTP 503');
  });

  it('labels an aborted request as a timeout rather than a bare error', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    stubFetch(
      () => Promise.reject(abort),
      () => Promise.resolve(json(CRYPTO_OK)),
    );
    const s = await new CurrencyService(tmp).refresh();
    expect(s.lastError).toContain('timeout');
  });
});

describe('CurrencyService — startup', () => {
  it('starts with no rates and no error before the first refresh', () => {
    const s = new CurrencyService(tmp).get();
    expect(s.source).toBe('none');
    expect(s.rates).toEqual({});
    expect(s.lastError).toBeNull();
  });

  it('recovers from a corrupt cache file', () => {
    fs.writeFileSync(path.join(tmp, 'currency-cache.json'), 'not json');
    expect(() => new CurrencyService(tmp)).not.toThrow();
    expect(new CurrencyService(tmp).get().source).toBe('none');
  });

  it('always reports USD as the base', async () => {
    stubFetch(
      () => Promise.resolve(json(FIAT_OK)),
      () => Promise.resolve(json(CRYPTO_OK)),
    );
    expect((await new CurrencyService(tmp).refresh()).base).toBe('USD');
  });
});
