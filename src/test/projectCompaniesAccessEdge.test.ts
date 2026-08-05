import { describe, it, expect } from 'vitest';
import { wouldCreateUnsafeAccessEdge } from '@/lib/projectCompanies';

describe('dual-persona access_edge safety', () => {
  it('allows GC master first-linked as GC (permission seat)', () => {
    expect(wouldCreateUnsafeAccessEdge({
      hasAccess: false,
      role: 'gc',
      parentCompanyId: 'client-1',
      masterType: 'gc',
    })).toBeNull();
  });

  it('blocks GC master first-linked as contractor under another GC', () => {
    expect(wouldCreateUnsafeAccessEdge({
      hasAccess: false,
      role: 'contractor',
      parentCompanyId: 'peer-gc',
      masterType: 'gc',
    })).toMatch(/먼저 기본 역할/);
  });

  it('allows secondary contractor when permission seat already exists', () => {
    expect(wouldCreateUnsafeAccessEdge({
      hasAccess: true,
      role: 'contractor',
      parentCompanyId: 'peer-gc',
      masterType: 'gc',
    })).toBeNull();
  });

  it('allows real contractor master under a GC as first link', () => {
    expect(wouldCreateUnsafeAccessEdge({
      hasAccess: false,
      role: 'contractor',
      parentCompanyId: 'gc-1',
      masterType: 'contractor',
    })).toBeNull();
  });
});
