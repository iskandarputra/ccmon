/**
 * @file envText.test.ts
 * @brief Unit tests for the wizard's KEY=value env editor parsing.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import { envToText, parseEnvText } from '../../components/accounts/SetupWizard';
import { deepseekWrapperName } from '../deepseek';

describe('parseEnvText', () => {
  it('reads a plain KEY=value block', () => {
    expect(parseEnvText('ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic\nX=1')).toEqual({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      X: '1',
    });
  });

  it('tolerates what people actually paste: export prefixes, quotes, comments, blanks', () => {
    // straight out of a hand-written launcher script
    const text = [
      '# ── Provider ──',
      'export ANTHROPIC_BASE_URL="https://api.deepseek.com/anthropic"',
      '',
      "  export ANTHROPIC_MODEL='deepseek-v4-pro[1m]'  ",
      'MAX_THINKING_TOKENS=65536',
    ].join('\n');
    expect(parseEnvText(text)).toEqual({
      ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
      ANTHROPIC_MODEL: 'deepseek-v4-pro[1m]',
      MAX_THINKING_TOKENS: '65536',
    });
  });

  it('keeps = inside a value and drops lines that are not assignments', () => {
    expect(parseEnvText('A=b=c\nnonsense\n=novalue')).toEqual({ A: 'b=c' });
  });

  it('round-trips through envToText', () => {
    const env = { A: '1', B: 'two words' };
    expect(parseEnvText(envToText(env))).toEqual(env);
  });

  it('an empty editor means no env at all', () => {
    expect(parseEnvText('')).toEqual({});
    expect(parseEnvText('\n  \n# just a comment\n')).toEqual({});
  });
});

describe('deepseekWrapperName — is a DeepSeek launcher actually set up?', () => {
  const root = '/home/isz/.claude-deepseek';

  it('finds the wrapper by its base URL, not by the account name', () => {
    // the name is the user's to choose, the endpoint is not
    expect(
      deepseekWrapperName({
        [root]: { name: 'ds', env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic' } },
      }),
    ).toBe('ds');
  });

  it('is null when a key is connected but no wrapper exists — the case the UI must call out', () => {
    expect(deepseekWrapperName({})).toBeNull();
    expect(deepseekWrapperName({ '/home/isz/.claude': { name: 'claude-personal' } })).toBeNull();
  });

  it('ignores an untracked account, whose wrapper is not generated', () => {
    expect(
      deepseekWrapperName({
        [root]: { name: 'ds', disabled: true, env: { ANTHROPIC_BASE_URL: 'https://api.deepseek.com' } },
      }),
    ).toBeNull();
  });

  it('falls back to a derived name when the account was never renamed', () => {
    expect(
      deepseekWrapperName({ [root]: { env: { ANTHROPIC_BASE_URL: 'https://api.DEEPSEEK.com' } } }),
    ).toBe('claude-deepseek');
  });
});
