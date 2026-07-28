import { describe, it, expect } from 'vitest';
import { formatPermitStamp } from '@/lib/permitDateFormat';

describe('formatPermitStamp', () => {
  it('formats ISO with date and time', () => {
    // Local timezone dependent — check pattern
    const s = formatPermitStamp('2026-07-28T14:05:00+09:00');
    expect(s).toMatch(/2026\. 07\. 28\. \d{2}:\d{2}/);
  });

  it('returns empty for invalid', () => {
    expect(formatPermitStamp(null)).toBe('');
    expect(formatPermitStamp('')).toBe('');
    expect(formatPermitStamp('not-a-date')).toBe('');
  });
});
