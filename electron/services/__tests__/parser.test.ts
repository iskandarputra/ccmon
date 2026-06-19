/**
 * @file parser.test.ts
 * @brief Unit tests for transcript parsing — entries, skip rules, reset/compact markers.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import { decodeProjectDir, localDateKey, parseLine } from '../parser';
import type { UsageEntry } from '../../../shared/types';

const FILE = '/data/projects/-home-user-proj/abc-session.jsonl';

function assistantLine(over: Record<string, unknown> = {}, usage: Record<string, unknown> = {}) {
  const { message: msgOver, ...rest } = over as { message?: object } & Record<string, unknown>;
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-06-01T10:00:00.000Z',
    cwd: '/home/user/proj',
    sessionId: 'sess-1',
    requestId: 'req-1',
    message: {
      id: 'msg-1',
      model: 'claude-test-1',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 200,
        ...usage,
      },
      ...(msgOver || {}),
    },
    ...rest,
  });
}

function entry(raw: string, file = FILE, line = 1): UsageEntry {
  const parsed = parseLine(raw, file, line);
  if (!parsed || parsed.kind !== 'entry') throw new Error('expected an entry');
  return parsed;
}

describe('parseLine — entries', () => {
  it('parses the documented fields', () => {
    const e = entry(assistantLine());
    expect(e.key).toBe('msg-1:req-1');
    expect(e.msgId).toBe('msg-1');
    expect(e.model).toBe('claude-test-1');
    expect(e.project).toBe('/home/user/proj');
    expect(e.sessionId).toBe('sess-1');
    expect(e.in).toBe(100);
    expect(e.out).toBe(50);
    expect(e.read).toBe(1000);
    expect(e.ts).toBe(Date.parse('2026-06-01T10:00:00.000Z'));
    expect(e.dateKey).toBe(localDateKey(e.ts));
    expect(e.sidechain).toBe(false);
    expect(e.costUSD).toBeNull();
  });

  it('key falls back to m:<id> then f:<file>#<line>', () => {
    const noReq = JSON.parse(assistantLine()) as Record<string, unknown>;
    delete noReq.requestId;
    expect(entry(JSON.stringify(noReq)).key).toBe('m:msg-1');

    const noMsg = JSON.parse(assistantLine()) as { message: { id?: string } };
    delete noMsg.message.id;
    expect(entry(JSON.stringify(noMsg), FILE, 7).key).toBe(`f:${FILE}#7`);
  });

  it('w5m takes the whole cache_creation total when no breakdown exists', () => {
    const e = entry(assistantLine());
    expect(e.w5m).toBe(200);
    expect(e.w1h).toBe(0);
  });

  it('uses the ephemeral breakdown and bills the remainder as 5m', () => {
    const e = entry(
      assistantLine({}, {
        cache_creation_input_tokens: 300,
        cache_creation: { ephemeral_5m_input_tokens: 100, ephemeral_1h_input_tokens: 50 },
      }),
    );
    // 100 + 50 < 300 → remainder billed at 5m: w5m = 300 − 50
    expect(e.w5m).toBe(250);
    expect(e.w1h).toBe(50);
  });

  it('appends -fast and flags fast for speed: fast', () => {
    const e = entry(assistantLine({}, { speed: 'fast' }));
    expect(e.model).toBe('claude-test-1-fast');
    expect(e.fast).toBe(true);
  });

  it('keeps tool_use names in order and the stop reason', () => {
    const e = entry(
      assistantLine({
        message: {
          content: [
            { type: 'text', text: 'hi' },
            { type: 'tool_use', name: 'Bash' },
            { type: 'tool_use', name: 'Bash' },
            { type: 'tool_use', name: 'Edit' },
          ],
          stop_reason: 'tool_use',
        },
      }),
    );
    expect(e.tools).toEqual(['Bash', 'Bash', 'Edit']);
    expect(e.stop).toBe('tool_use');
  });

  it('falls back to the decoded dir name when cwd is missing', () => {
    const raw = JSON.parse(assistantLine()) as Record<string, unknown>;
    delete raw.cwd;
    expect(entry(JSON.stringify(raw)).project).toBe(decodeProjectDir('-home-user-proj'));
  });
});

describe('parseLine — skip rules', () => {
  it.each([
    ['user line', JSON.stringify({ type: 'user', timestamp: '2026-06-01T10:00:00Z' })],
    ['no usage', assistantLine({ message: { usage: undefined } })],
    ['synthetic model', assistantLine({ message: { model: '<synthetic>' } })],
    ['missing model', assistantLine({ message: { model: undefined } })],
    ['bad timestamp', assistantLine({ timestamp: 'not-a-date' })],
    ['malformed json', '{nope'],
  ])('returns null for %s', (_label, raw) => {
    expect(parseLine(raw, FILE, 1)).toBeNull();
  });
});

describe('parseLine — markers', () => {
  it('returns a reset marker for usage-limit API errors', () => {
    const raw = JSON.stringify({
      type: 'assistant',
      isApiErrorMessage: true,
      timestamp: '2026-06-01T10:00:00Z',
      message: { content: 'Claude AI usage limit reached|1780000000' },
    });
    const parsed = parseLine(raw, FILE, 1);
    expect(parsed).toMatchObject({ kind: 'reset', resetTs: 1_780_000_000_000 });
  });

  it('returns null for other API errors', () => {
    const raw = JSON.stringify({
      type: 'assistant',
      isApiErrorMessage: true,
      timestamp: '2026-06-01T10:00:00Z',
      message: { content: 'overloaded' },
    });
    expect(parseLine(raw, FILE, 1)).toBeNull();
  });

  it('returns a compact marker for isCompactSummary lines', () => {
    const raw = JSON.stringify({
      type: 'user',
      isCompactSummary: true,
      timestamp: '2026-06-01T10:00:00Z',
      sessionId: 'sess-9',
    });
    const parsed = parseLine(raw, FILE, 1);
    expect(parsed).toMatchObject({ kind: 'compact', sessionId: 'sess-9' });
  });

  it('returns a toolresult marker sizing tool_result content (string + blocks)', () => {
    const raw = JSON.stringify({
      type: 'user',
      timestamp: '2026-06-01T10:00:00Z',
      sessionId: 'sess-tr',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 't1', content: 'hello' }, // 5 chars
          { type: 'tool_result', tool_use_id: 't2', content: [{ type: 'text', text: 'world!' }] }, // 6 chars
        ],
      },
    });
    expect(parseLine(raw, FILE, 1)).toMatchObject({ kind: 'toolresult', sessionId: 'sess-tr', chars: 11 });
  });

  it('does NOT treat a user line without tool_result as a marker', () => {
    const raw = JSON.stringify({
      type: 'user',
      timestamp: '2026-06-01T10:00:00Z',
      message: { content: [{ type: 'text', text: 'just a prompt' }] },
    });
    expect(parseLine(raw, FILE, 1)).toBeNull();
  });
});
