/**
 * @file aliases.test.ts
 * @brief Unit tests for display aliases — resolution, -fast inheritance, fallbacks.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import { aliasFor, projectLabel, shortProject } from '../aliases';

const ARN = 'arn:aws:bedrock:ap-northeast-1:012345678910:application-inference-profile/abcde12345';

describe('aliasFor', () => {
  it('resolves an exact match', () => {
    expect(aliasFor(ARN, { [ARN]: 'opus-4-6 (bedrock)' })).toBe('opus-4-6 (bedrock)');
  });

  it('lets a -fast variant inherit its base alias, keeping the suffix', () => {
    expect(aliasFor('claude-opus-5-fast', { 'claude-opus-5': 'opus' })).toBe('opus-fast');
  });

  it('prefers an explicit -fast alias over the inherited one', () => {
    const m = { 'claude-opus-5': 'opus', 'claude-opus-5-fast': 'opus turbo' };
    expect(aliasFor('claude-opus-5-fast', m)).toBe('opus turbo');
  });

  it('returns the raw id untouched when nothing matches', () => {
    expect(aliasFor('claude-opus-5', { other: 'x' })).toBe('claude-opus-5');
    expect(aliasFor('claude-opus-5', null)).toBe('claude-opus-5');
    expect(aliasFor('claude-opus-5', undefined)).toBe('claude-opus-5');
    expect(aliasFor('claude-opus-5', {})).toBe('claude-opus-5');
  });

  it('ignores an empty alias rather than blanking the label', () => {
    expect(aliasFor('claude-opus-5', { 'claude-opus-5': '' })).toBe('claude-opus-5');
  });

  it('handles an empty raw id', () => {
    expect(aliasFor('', { '': 'x' })).toBe('');
  });
});

describe('shortProject', () => {
  it('keeps the last segment, which is what distinguishes siblings', () => {
    expect(shortProject('/home/me/Documents/work/api')).toBe('api');
    expect(shortProject('C:\\Users\\me\\proj')).toBe('proj');
  });

  it('tolerates trailing separators and bare names', () => {
    expect(shortProject('/home/me/api/')).toBe('api');
    expect(shortProject('api')).toBe('api');
    expect(shortProject('/')).toBe('/');
    expect(shortProject('')).toBe('');
  });
});

describe('projectLabel', () => {
  it('prefers an explicit alias', () => {
    expect(projectLabel('/home/me/work/api', { '/home/me/work/api': 'API service' })).toBe(
      'API service',
    );
  });

  it('falls back to the shortened path', () => {
    expect(projectLabel('/home/me/work/api', {})).toBe('api');
    expect(projectLabel('/home/me/work/api', null)).toBe('api');
  });
});
