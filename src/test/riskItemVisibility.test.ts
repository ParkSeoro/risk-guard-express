import { describe, it, expect } from 'vitest';
import { isActiveRiskItem } from '@/lib/riskItemVisibility';

describe('isActiveRiskItem', () => {
  it('matches the detail-page 상 count (drops deleted and excluded rows)', () => {
    expect(isActiveRiskItem({ is_deleted: false, is_excluded: false })).toBe(true);
    expect(isActiveRiskItem({})).toBe(true);
    expect(isActiveRiskItem({ is_deleted: true, is_excluded: false })).toBe(false);
    expect(isActiveRiskItem({ is_deleted: false, is_excluded: true })).toBe(false);
  });
});
