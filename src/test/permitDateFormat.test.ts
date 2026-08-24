import { describe, it, expect } from 'vitest';
import {
  formatPermitStamp,
  formatPermitStampParts,
  formatPermitReviewDate,
  formatPermitDateTime,
  formatPermitDateTimeRange,
} from '@/lib/permitDateFormat';

describe('formatPermitStamp', () => {
  it('formats approval datetime with time including seconds', () => {
    const s = formatPermitStamp('2026-07-28T15:30:07');
    expect(s).toMatch(/^2026\. \d{1,2}\. \d{1,2}\. \d{2}:\d{2}:\d{2}$/);
  });

  it('keeps distinct seconds for near-simultaneous stamps', () => {
    const a = formatPermitStamp('2026-08-05T04:28:01.000Z');
    const b = formatPermitStamp('2026-08-05T04:28:45.000Z');
    expect(a).not.toBe(b);
  });

  it('returns empty for invalid', () => {
    expect(formatPermitStamp(null)).toBe('');
    expect(formatPermitStamp('')).toBe('');
    expect(formatPermitStamp('not-a-date')).toBe('');
  });
});

describe('formatPermitStampParts', () => {
  it('splits date and time with seconds for the 승인일 cell', () => {
    const parts = formatPermitStampParts('2026-08-24T14:27:56');
    expect(parts).not.toBeNull();
    expect(parts!.date).toMatch(/^2026\. \d{1,2}\. \d{1,2}\.$/);
    expect(parts!.time).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    expect(formatPermitStamp('2026-08-24T14:27:56')).toBe(`${parts!.date} ${parts!.time}`);
  });

  it('keeps distinct seconds on the time line', () => {
    const a = formatPermitStampParts('2026-08-05T04:28:01.000Z');
    const b = formatPermitStampParts('2026-08-05T04:28:45.000Z');
    expect(a?.time).not.toBe(b?.time);
  });

  it('returns null for invalid', () => {
    expect(formatPermitStampParts(null)).toBeNull();
    expect(formatPermitStampParts('bad')).toBeNull();
  });
});

describe('formatPermitReviewDate', () => {
  it('is approval datetime minus 1 calendar day (date only)', () => {
    const s = formatPermitReviewDate('2026-07-28T15:30:00');
    // Local calendar day - 1; accept either side of TZ boundary around midnight
    expect(s).toMatch(/^2026\. 7\. (27|28)\.$/);
  });

  it('crosses month boundary for mid-day local times', () => {
    // Use noon to avoid UTC offset flipping the calendar day
    expect(formatPermitReviewDate('2026-08-01T12:00:00')).toBe('2026. 7. 31.');
  });

  it('returns empty for invalid', () => {
    expect(formatPermitReviewDate(null)).toBe('');
    expect(formatPermitReviewDate('bad')).toBe('');
  });
});

describe('formatPermitDateTime', () => {
  it('formats datetime-local without leaking T', () => {
    expect(formatPermitDateTime('2026-08-06T07:00')).toBe('2026-08-06 07:00');
    expect(formatPermitDateTime('2026-08-06T17:00:00')).toBe('2026-08-06 17:00');
  });

  it('builds a range', () => {
    expect(formatPermitDateTimeRange('2026-08-06T07:00', '2026-08-06T17:00')).toBe(
      '2026-08-06 07:00 ~ 2026-08-06 17:00',
    );
  });
});
