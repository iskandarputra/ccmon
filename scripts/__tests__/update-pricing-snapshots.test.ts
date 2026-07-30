/**
 * @file update-pricing-snapshots.test.ts
 * @brief Unit tests for the snapshot merge policy — retire-safe pricing.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import { describe, expect, it } from 'vitest';
import { mergeRetaining } from '../update-pricing-snapshots';

describe('mergeRetaining', () => {
  it('keeps committed entries the upstream stopped publishing', () => {
    const existing = { 'claude-3-5-sonnet-20241022': 1, 'claude-opus-4-8': 2 };
    const fresh = { 'claude-opus-4-8': 2, 'claude-opus-5': 3 };
    const { merged, retained } = mergeRetaining(existing, fresh);
    expect(merged).toEqual({
      'claude-3-5-sonnet-20241022': 1,
      'claude-opus-4-8': 2,
      'claude-opus-5': 3,
    });
    expect(retained).toEqual(['claude-3-5-sonnet-20241022']);
  });

  it('lets a fresh entry win on conflict — live rates still move', () => {
    const { merged, retained } = mergeRetaining({ m: 'old' }, { m: 'new' });
    expect(merged.m).toBe('new');
    expect(retained).toEqual([]);
  });

  it('drops nothing and retains nothing when the catalogs agree', () => {
    const { merged, retained } = mergeRetaining({ a: 1 }, { a: 1 });
    expect(merged).toEqual({ a: 1 });
    expect(retained).toEqual([]);
  });

  it('is a plain overwrite under --prune, for correcting a bad entry', () => {
    const { merged, retained } = mergeRetaining({ wrong: 1 }, { right: 2 }, true);
    expect(merged).toEqual({ right: 2 });
    expect(retained).toEqual([]);
  });

  it('accepts an empty committed snapshot (first run)', () => {
    const { merged, retained } = mergeRetaining({}, { a: 1 });
    expect(merged).toEqual({ a: 1 });
    expect(retained).toEqual([]);
  });

  it('does not mutate either input', () => {
    const existing = { a: 1 };
    const fresh = { b: 2 };
    mergeRetaining(existing, fresh);
    expect(existing).toEqual({ a: 1 });
    expect(fresh).toEqual({ b: 2 });
  });
});
