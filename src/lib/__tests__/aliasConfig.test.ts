/**
 * @file aliasConfig.test.ts
 * @brief Unit tests for the renderer's configured alias layer.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { afterEach, describe, expect, it } from 'vitest';
import { configureAliases, modelAlias, projectAlias } from '../format';

const ARN = 'arn:aws:bedrock:ap-northeast-1:012345678910:application-inference-profile/abcde12345';

afterEach(() => configureAliases({}, {}));

describe('configureAliases', () => {
  it('starts empty, so an unconfigured app aliases nothing', () => {
    expect(modelAlias('claude-opus-5')).toBeNull();
    expect(projectAlias('/home/me/api')).toBeNull();
  });

  it('reports whether anything actually changed', () => {
    const models = { a: 'A' };
    const projects = { b: 'B' };
    expect(configureAliases(models, projects)).toBe(true);
    expect(configureAliases(models, projects)).toBe(false); // same refs → no-op
  });

  it('resolves a configured model alias and leaves others null', () => {
    configureAliases({ [ARN]: 'opus-4-6 (bedrock)' }, {});
    expect(modelAlias(ARN)).toBe('opus-4-6 (bedrock)');
    expect(modelAlias('claude-opus-5')).toBeNull();
  });

  it('carries a model alias onto its -fast variant', () => {
    configureAliases({ 'claude-opus-5': 'opus' }, {});
    expect(modelAlias('claude-opus-5-fast')).toBe('opus-fast');
  });

  it('resolves a configured project alias', () => {
    configureAliases({}, { '/home/me/work/api': 'API service' });
    expect(projectAlias('/home/me/work/api')).toBe('API service');
    expect(projectAlias('/home/me/work/web')).toBeNull();
  });

  it('tolerates null-ish maps without throwing', () => {
    expect(() =>
      configureAliases(
        null as unknown as Record<string, string>,
        undefined as unknown as Record<string, string>,
      ),
    ).not.toThrow();
    expect(modelAlias('claude-opus-5')).toBeNull();
  });
});
