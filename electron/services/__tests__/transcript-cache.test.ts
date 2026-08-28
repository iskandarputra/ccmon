/**
 * @file transcript-cache.test.ts
 * @brief Unit tests for transcript persistent cache serialization and resilience.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadTranscriptCache, saveTranscriptCache, CACHE_VERSION } from '../transcript-cache';
import type { UsageEntry } from '../../../shared/types';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccmon-cache-test-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const cacheFile = (name = 'test-cache.json') => path.join(tmp, name);

describe('TranscriptCache', () => {
  const dummyEntry: UsageEntry = {
    key: 'test-key',
    ts: 1720000000000,
    dateKey: '2024-07-03',
    sessionId: 'sess-1',
    msgId: 'msg-1',
    project: 'proj-1',
    model: 'claude-opus-5',
    fast: false,
    sidechain: false,
    in: 100,
    out: 200,
    read: 50,
    w5m: 10,
    w1h: 0,
    costUSD: 0.05,
    source: '/test/source',
  };

  it('returns null when cache file does not exist', async () => {
    const result = await loadTranscriptCache(cacheFile('nonexistent.json'));
    expect(result).toBeNull();
  });

  it('returns null on corrupt JSON', async () => {
    const f = cacheFile('corrupt.json');
    await fs.promises.writeFile(f, '{ not valid json');
    const result = await loadTranscriptCache(f);
    expect(result).toBeNull();
  });

  it('saves and reloads cached index accurately', async () => {
    const f = cacheFile('valid.json');
    await saveTranscriptCache(f, {
      files: {
        '/test/file.jsonl': { mtimeMs: 123456789, size: 4096 },
      },
      entries: [dummyEntry],
      compactions: [],
      toolResults: [{ source: '/test/source', day: '2024-07-03', count: 5, chars: 1200 }],
      limits: [],
      resetTs: 1720050000000,
    });

    const loaded = await loadTranscriptCache(f);
    expect(loaded).not.toBeNull();
    expect(loaded?.version).toBe(CACHE_VERSION);
    expect(loaded?.entries).toHaveLength(1);
    expect(loaded?.entries[0].key).toBe('test-key');
    expect(loaded?.files['/test/file.jsonl'].size).toBe(4096);
    expect(loaded?.toolResults[0].count).toBe(5);
    expect(loaded?.resetTs).toBe(1720050000000);
  });
});
