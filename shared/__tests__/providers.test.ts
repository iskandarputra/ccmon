/**
 * @file providers.test.ts
 * @brief Unit tests for provider + billing-channel detection across deployments.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import {
  detectProvider,
  detectProviders,
  isApiKeyOnly,
  isDeepseekModel,
  usesDeepseek,
} from '../providers';

describe('detectProvider — first-party', () => {
  it('recognises Claude Code / API ids', () => {
    expect(detectProvider('claude-opus-5')).toEqual({
      id: 'anthropic',
      label: 'Anthropic',
      deployment: 'first-party',
    });
    expect(detectProvider('claude-sonnet-4-5-20250929')?.deployment).toBe('first-party');
  });

  it('recognises DeepSeek and Gemini', () => {
    expect(detectProvider('deepseek-v4-pro')?.id).toBe('deepseek');
    expect(detectProvider('deepseek/deepseek-chat')?.id).toBe('deepseek');
    expect(detectProvider('gemini-3-flash-preview')?.id).toBe('google');
  });

  it('treats a -fast variant as the same model and channel', () => {
    expect(detectProvider('claude-opus-5-fast')).toEqual(detectProvider('claude-opus-5'));
    expect(detectProvider('anthropic.claude-opus-4-6-v1-fast')?.deployment).toBe('bedrock');
  });

  it('returns null for genuinely unknown ids', () => {
    // `gpt-5.5` used to stand here as the example of an unknown id. It is a
    // first-class model now — ccmon reads, prices and displays it — so the
    // example moved to something no rule claims.
    expect(detectProvider('')).toBeNull();
    expect(detectProvider('some-internal-thing')).toBeNull();
    expect(detectProvider('opus-something')).toBeNull();
  });
});

describe('detectProvider — Bedrock', () => {
  it('recognises the plain publisher-prefixed form', () => {
    expect(detectProvider('anthropic.claude-opus-4-6-v1')).toEqual({
      id: 'anthropic',
      label: 'Anthropic',
      deployment: 'bedrock',
    });
  });

  it('recognises regional inference profiles', () => {
    for (const id of [
      'us.anthropic.claude-sonnet-4-5-v1:0',
      'eu.anthropic.claude-opus-4-6-v1',
      'apac.anthropic.claude-haiku-4-5-v1:0',
    ]) {
      expect(detectProvider(id)?.deployment).toBe('bedrock');
      expect(detectProvider(id)?.id).toBe('anthropic');
    }
  });

  it('recognises a full application-inference-profile ARN', () => {
    const arn =
      'arn:aws:bedrock:ap-northeast-1:012345678910:application-inference-profile/abcde12345';
    expect(detectProvider(arn)?.deployment).toBe('bedrock');
  });
});

describe('detectProvider — Vertex', () => {
  it('recognises the publisher-slash form', () => {
    expect(detectProvider('anthropic/claude-opus-4-5')?.deployment).toBe('vertex');
  });

  it('recognises the dated @YYYYMMDD alias', () => {
    expect(detectProvider('claude-3-5-sonnet@20240620')?.deployment).toBe('vertex');
  });

  it('does not mistake an undated first-party id for Vertex', () => {
    expect(detectProvider('claude-opus-4-5')?.deployment).toBe('first-party');
    // a plain date SUFFIX (not @-separated) is first-party
    expect(detectProvider('claude-opus-4-1-20250805')?.deployment).toBe('first-party');
  });
});

describe('detectProviders', () => {
  it('keeps Bedrock and first-party Anthropic apart', () => {
    const found = detectProviders(['claude-opus-5', 'anthropic.claude-opus-4-6-v1']);
    expect(found).toHaveLength(2);
    expect(found.map((p) => p.deployment).sort()).toEqual(['bedrock', 'first-party']);
  });

  it('dedupes within a channel', () => {
    expect(detectProviders(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'])).toHaveLength(
      1,
    );
  });

  it('skips unknown ids without inventing a provider', () => {
    expect(detectProviders(['some-internal-thing', 'mystery'])).toEqual([]);
  });
});

describe('isApiKeyOnly — decides whether a subscription comparison is honest', () => {
  it('is false for first-party Claude, which a subscription can cover', () => {
    expect(isApiKeyOnly(['claude-opus-5'])).toBe(false);
    expect(isApiKeyOnly(['claude-opus-5', 'deepseek-v4-pro'])).toBe(false);
  });

  it('is true for DeepSeek-only usage', () => {
    expect(isApiKeyOnly(['deepseek-v4-pro', 'deepseek-v4-flash'])).toBe(true);
  });

  it('is TRUE for Bedrock-only Anthropic usage — the regression this fixes', () => {
    // Bedrock is consumption-billed. Reporting a subscription saving here would
    // invent a saving the user never had.
    expect(isApiKeyOnly(['anthropic.claude-opus-4-6-v1'])).toBe(true);
    expect(isApiKeyOnly(['us.anthropic.claude-sonnet-4-5-v1:0'])).toBe(true);
  });

  it('is true for Vertex-only Anthropic usage', () => {
    expect(isApiKeyOnly(['anthropic/claude-opus-4-5'])).toBe(true);
    expect(isApiKeyOnly(['claude-3-5-sonnet@20240620'])).toBe(true);
  });

  it('is false once ANY first-party Claude usage is present', () => {
    expect(isApiKeyOnly(['anthropic.claude-opus-4-6-v1', 'claude-opus-5'])).toBe(false);
  });

  it('is false when nothing is recognised — never guess a billing model', () => {
    expect(isApiKeyOnly([])).toBe(false);
    expect(isApiKeyOnly(['some-internal-thing'])).toBe(false);
  });
});

describe('DeepSeek helpers', () => {
  it('identifies DeepSeek models across channels', () => {
    expect(isDeepseekModel('deepseek-v4-pro')).toBe(true);
    expect(isDeepseekModel('claude-opus-5')).toBe(false);
    expect(usesDeepseek(['claude-opus-5', 'deepseek-v4-flash'])).toBe(true);
    expect(usesDeepseek(['claude-opus-5'])).toBe(false);
  });

  it('is not confused by OpenAI ids', () => {
    expect(usesDeepseek(['gpt-5.5', 'claude-opus-5'])).toBe(false);
  });
});

describe('detectProvider — OpenAI / Codex', () => {
  it('recognises the gpt family rather than bucketing it as Other', () => {
    // Codex usage previously fell through every rule, so it landed in the
    // provider breakdown's "Other" bucket — the same hole Bedrock and Vertex
    // ids used to fall through before the rules became channel-aware.
    for (const m of ['gpt-5', 'gpt-5.5', 'gpt-5.6-terra', 'gpt-5.2-codex']) {
      expect(detectProvider(m), m).toMatchObject({
        id: 'openai',
        label: 'OpenAI',
        deployment: 'first-party',
      });
    }
  });

  it('recognises the reasoning-model and prefixed spellings', () => {
    expect(detectProvider('o3-mini')).toMatchObject({ id: 'openai' });
    expect(detectProvider('openai/gpt-5')).toMatchObject({ id: 'openai' });
  });

  it('treats a -fast variant as the same model on the same channel', () => {
    expect(detectProvider('gpt-5.5-fast')).toEqual(detectProvider('gpt-5.5'));
  });

  it('keeps a Claude subscription comparison honest alongside Codex usage', () => {
    // Codex is consumption-billed, but its presence must not flip the whole
    // view into api-key-only mode while a first-party Claude login is there.
    expect(isApiKeyOnly(['claude-opus-5', 'gpt-5.6-terra'])).toBe(false);
    expect(isApiKeyOnly(['gpt-5.6-terra'])).toBe(true);
  });

  it('lists each provider once, in first-seen order', () => {
    expect(
      detectProviders(['claude-opus-5', 'gpt-5.5', 'claude-sonnet-5', 'deepseek-v4-pro']).map(
        (p) => p.id,
      ),
    ).toEqual(['anthropic', 'openai', 'deepseek']);
  });
});
