/**
 * @file currency.ts
 * @brief Hourly display-currency rates — all-world fiat plus top-10 crypto, keep-last-good.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import path from 'path';
import { CRYPTO_CURRENCIES } from '../../shared/types';
import type { CurrencyRates } from '../../shared/types';

/**
 * Hourly USD exchange rates for display conversion (docs/v2-spec.md §5).
 *
 * Everything internal stays USD; the renderer converts at format time. Two
 * legs per refresh, fetched in parallel: all-world fiat (open.er-api.com,
 * ~160 ISO codes) and the top-10 crypto (CoinGecko). A failed leg keeps its
 * previous rates and reports a verbose reason — same keep-last-good pattern
 * as pricing/limits. Pure Node, no Electron imports.
 */

const FIAT_URL = 'https://open.er-api.com/v6/latest/USD';
const CRYPTO_URL =
  'https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=' +
  Object.values(CRYPTO_CURRENCIES).join(',');
const FETCH_TIMEOUT_MS = 10_000;

interface RatesApiResponse {
  result?: string;
  rates?: Record<string, unknown>;
}

/** CoinGecko simple/price: { bitcoin: { usd: 97000 }, … } */
type CryptoApiResponse = Record<string, { usd?: unknown }>;

interface DiskCache {
  fetchedAt: number;
  rates: Record<string, number>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/** Fiat leg: ISO code → units per USD. Throws with a readable reason. */
async function fetchFiat(): Promise<Record<string, number>> {
  const data = await fetchJson<RatesApiResponse>(FIAT_URL);
  const rates: Record<string, number> = {};
  for (const [code, v] of Object.entries(data.rates || {})) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) rates[code] = v;
  }
  if (data.result !== 'success' || !Object.keys(rates).length) {
    throw new Error('no usable rates in response');
  }
  return rates;
}

/** Crypto leg: code → units per USD (inverse of the coin's USD price). */
async function fetchCrypto(): Promise<Record<string, number>> {
  const data = await fetchJson<CryptoApiResponse>(CRYPTO_URL);
  const rates: Record<string, number> = {};
  for (const [code, id] of Object.entries(CRYPTO_CURRENCIES)) {
    const price = data[id]?.usd;
    if (typeof price === 'number' && Number.isFinite(price) && price > 0) {
      rates[code] = 1 / price;
    }
  }
  if (!Object.keys(rates).length) throw new Error('no usable prices in response');
  return rates;
}

export class CurrencyService {
  private readonly file: string;
  private state: CurrencyRates = {
    base: 'USD',
    fetchedAt: null,
    source: 'none',
    rates: {},
    lastError: null,
  };

  constructor(cacheDir: string) {
    this.file = path.join(cacheDir, 'currency-cache.json');
    try {
      const cached = JSON.parse(fs.readFileSync(this.file, 'utf8')) as DiskCache;
      if (cached?.rates && typeof cached.rates === 'object') {
        this.state = {
          base: 'USD',
          fetchedAt: cached.fetchedAt || null,
          source: 'cache',
          rates: cached.rates,
          lastError: null,
        };
      }
    } catch {
      /* no cache yet — first refresh fills it */
    }
  }

  get(): CurrencyRates {
    return this.state;
  }

  /**
   * Fetch both legs in parallel and merge over the previous table, so a
   * failed leg keeps serving its last good rates. lastError says which leg
   * failed and why; null only when both succeeded.
   */
  async refresh(): Promise<CurrencyRates> {
    const reason = (r: PromiseRejectedResult) => {
      const e = r.reason as Error;
      return e?.name === 'AbortError' ? `timeout after ${FETCH_TIMEOUT_MS / 1000}s` : e?.message || 'fetch failed';
    };
    const [fiat, crypto] = await Promise.allSettled([fetchFiat(), fetchCrypto()]);
    const errors: string[] = [];
    if (fiat.status === 'rejected') errors.push(`fiat (open.er-api.com): ${reason(fiat)}`);
    if (crypto.status === 'rejected') errors.push(`crypto (coingecko): ${reason(crypto)}`);

    if (fiat.status === 'rejected' && crypto.status === 'rejected') {
      this.state = { ...this.state, lastError: errors.join(' · ') };
      return this.state;
    }

    const rates = {
      ...this.state.rates,
      ...(fiat.status === 'fulfilled' ? fiat.value : {}),
      ...(crypto.status === 'fulfilled' ? crypto.value : {}),
    };
    const fetchedAt = Date.now();
    this.state = {
      base: 'USD',
      fetchedAt,
      source: 'live',
      rates,
      lastError: errors.length ? errors.join(' · ') : null,
    };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify({ fetchedAt, rates } satisfies DiskCache));
    } catch {
      /* cache write is best-effort */
    }
    return this.state;
  }
}
