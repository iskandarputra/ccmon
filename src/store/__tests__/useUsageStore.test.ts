/**
 * @file useUsageStore.test.ts
 * @brief Unit tests for the renderer store's reducers and the settings bridge.
 * @author Iskandar Putra <www.iskandarputra.com>
 *
 * The renderer had no tests at all. These start where the risk is highest: the
 * handful of places the store does more than assign a value — the feed ring
 * buffer, the first-load seed, and `lastEventTs`, all of which are order- and
 * bound-sensitive and none of which a type checker can see.
 *
 * The store is a module singleton, so every test restores the initial state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUsageStore } from '../useUsageStore';
import type { FeedEvent, Snapshot } from '../../../shared/types';

const INITIAL = useUsageStore.getState();
const get = () => useUsageStore.getState();

beforeEach(() => {
  useUsageStore.setState(INITIAL, true);
  // The store runs in a renderer, where `window` always exists. Tests run in
  // node, so provide the bridge surface the store reaches for; individual
  // tests re-stub it when they need to assert on the call.
  vi.stubGlobal('window', { ccmon: { setRange: vi.fn() } });
});
afterEach(() => vi.unstubAllGlobals());

const event = (ts: number, over: Partial<FeedEvent> = {}): FeedEvent =>
  ({ ts, model: 'claude-opus-5', cost: 0.01, in: 1, out: 1, ...over }) as FeedEvent;

const snapshot = (over: Record<string, unknown> = {}): Snapshot =>
  ({
    totals: { lastTs: 0 },
    recentEvents: [],
    ...over,
  }) as unknown as Snapshot;

describe('initial state', () => {
  it('starts disconnected with nothing loaded', () => {
    expect(get().status).toBe('connecting');
    expect(get().snapshot).toBeNull();
    expect(get().feed).toEqual([]);
    expect(get().view).toBe('overview');
    expect(get().range).toEqual({ preset: 'all' });
  });
});

describe('setSnapshot', () => {
  it('marks the store ready', () => {
    get().setSnapshot(snapshot());
    expect(get().status).toBe('ready');
  });

  /**
   * On first load there is no live feed yet, so the snapshot's recent events
   * seed it — reversed, because the snapshot lists them oldest-first and the
   * feed renders newest-first.
   */
  it('seeds an empty feed from recentEvents, newest first', () => {
    get().setSnapshot(snapshot({ recentEvents: [event(1), event(2), event(3)] }));
    expect(get().feed.map((e) => e.ts)).toEqual([3, 2, 1]);
  });

  /** A later snapshot must not wipe live events that arrived after it. */
  it('leaves an existing feed alone', () => {
    get().pushEvents([event(100)]);
    get().setSnapshot(snapshot({ recentEvents: [event(1), event(2)] }));
    expect(get().feed.map((e) => e.ts)).toEqual([100]);
  });

  it('does not copy the snapshot array by reference', () => {
    const recent = [event(1)];
    get().setSnapshot(snapshot({ recentEvents: recent }));
    expect(get().feed).not.toBe(recent);
  });

  it('tolerates a snapshot with no recentEvents field', () => {
    expect(() => get().setSnapshot(snapshot({ recentEvents: undefined }))).not.toThrow();
    expect(get().feed).toEqual([]);
  });

  it('advances lastEventTs but never rewinds it', () => {
    get().setSnapshot(snapshot({ totals: { lastTs: 500 } }));
    expect(get().lastEventTs).toBe(500);
    get().setSnapshot(snapshot({ totals: { lastTs: 100 } }));
    expect(get().lastEventTs).toBe(500);
  });

  it('leaves lastEventTs null when nothing has a timestamp', () => {
    get().setSnapshot(snapshot({ totals: { lastTs: 0 } }));
    expect(get().lastEventTs).toBeNull();
  });
});

describe('pushEvents', () => {
  it('prepends newest-first', () => {
    get().pushEvents([event(1), event(2)]);
    expect(get().feed.map((e) => e.ts)).toEqual([2, 1]);
  });

  it('keeps older batches below newer ones', () => {
    get().pushEvents([event(1)]);
    get().pushEvents([event(2)]);
    expect(get().feed.map((e) => e.ts)).toEqual([2, 1]);
  });

  /** The feed is a ring buffer; an unbounded one would grow all session. */
  it('caps the feed at 80 entries, dropping the oldest', () => {
    get().pushEvents(Array.from({ length: 100 }, (_, i) => event(i)));
    const feed = get().feed;
    expect(feed).toHaveLength(80);
    expect(feed[0].ts).toBe(99); // newest kept
    expect(feed[79].ts).toBe(20); // oldest 20 dropped
  });

  it('caps correctly across several pushes', () => {
    for (let i = 0; i < 10; i++) {
      get().pushEvents(Array.from({ length: 20 }, (_, j) => event(i * 20 + j)));
    }
    expect(get().feed).toHaveLength(80);
    expect(get().feed[0].ts).toBe(199);
  });

  it('tracks the newest timestamp in a batch', () => {
    get().pushEvents([event(5), event(90), event(12)]);
    expect(get().lastEventTs).toBe(90);
  });

  it('does not rewind lastEventTs on an out-of-order batch', () => {
    get().pushEvents([event(500)]);
    get().pushEvents([event(10)]);
    expect(get().lastEventTs).toBe(500);
  });

  it('handles an empty batch without producing -Infinity', () => {
    get().pushEvents([]);
    expect(get().lastEventTs).toBeNull();
    expect(get().feed).toEqual([]);
  });
});

describe('setLimits', () => {
  it('stores a limits map', () => {
    get().setLimits({ '/a': { ok: true } } as never);
    expect(Object.keys(get().limits)).toEqual(['/a']);
  });

  /** Main sends null when limits are unavailable; the UI must see {} not null. */
  it('coerces null and undefined to an empty map', () => {
    get().setLimits(null);
    expect(get().limits).toEqual({});
    get().setLimits(undefined);
    expect(get().limits).toEqual({});
  });
});

describe('setRange', () => {
  it('updates locally and tells main, so the UI does not wait for a round trip', () => {
    const setRange = vi.fn();
    vi.stubGlobal('window', { ccmon: { setRange } });
    get().setRange({ preset: '7d' });
    expect(get().range).toEqual({ preset: '7d' });
    expect(setRange).toHaveBeenCalledWith({ preset: '7d' });
  });

  it('still updates locally when the bridge is absent', () => {
    vi.stubGlobal('window', {});
    expect(() => get().setRange({ preset: 'today' })).not.toThrow();
    expect(get().range).toEqual({ preset: 'today' });
  });
});

describe('reset', () => {
  it('clears scan-derived state and returns to scanning', () => {
    get().setSnapshot(snapshot({ recentEvents: [event(1)] }));
    get().setProgress({ scanned: 5, total: 10, entries: 3 });
    get().reset();

    expect(get().status).toBe('scanning');
    expect(get().snapshot).toBeNull();
    expect(get().feed).toEqual([]);
    expect(get().progress).toEqual({ scanned: 0, total: 0, entries: 0 });
  });

  /**
   * A rescan re-reads the same files; it is not a sign-out. Wiping settings or
   * the chosen view would bounce the user back to Overview in a new theme.
   */
  it('preserves settings, view and range across a rescan', () => {
    get().setView('insights');
    get().setRange({ preset: '30d' });
    get().setSettings({ theme: 'nord' } as never);
    get().reset();

    expect(get().view).toBe('insights');
    expect(get().range).toEqual({ preset: '30d' });
    expect(get().settings).toMatchObject({ theme: 'nord' });
  });
});
