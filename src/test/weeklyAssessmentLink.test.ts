import { describe, expect, it } from 'vitest';
import {
  companyTargetsOverlap,
  isManagedResidualHigh,
  pickPreviousApprovedRun,
  resolveExecutionFeedbackTarget,
  resolvePrintFeedbackRun,
  type WeeklyLinkRun,
} from '@/lib/weeklyAssessmentLink';

function run(partial: Partial<WeeklyLinkRun> & { id: string }): WeeklyLinkRun {
  return {
    project_id: 'proj-1',
    type: '정기',
    status: '승인완료',
    created_at: '2026-08-01T00:00:00Z',
    target_company_ids: ['co-hitech'],
    period_label: partial.id,
    is_deleted: false,
    ...partial,
  };
}

describe('companyTargetsOverlap', () => {
  it('requires intersection when both have companies', () => {
    expect(companyTargetsOverlap(['hitech'], ['hitech', 'x'])).toBe(true);
    expect(companyTargetsOverlap(['hitech'], ['jinnam'])).toBe(false);
  });

  it('does not treat empty as all-companies', () => {
    expect(companyTargetsOverlap(['hitech'], [])).toBe(false);
    expect(companyTargetsOverlap([], ['jinnam'])).toBe(false);
    expect(companyTargetsOverlap(null, ['jinnam'])).toBe(false);
  });

  it('matches both-empty as the same unspecified bucket', () => {
    expect(companyTargetsOverlap([], [])).toBe(true);
    expect(companyTargetsOverlap(null, undefined)).toBe(true);
  });
});

describe('pickPreviousApprovedRun', () => {
  const current = run({
    id: 'next',
    status: '작성중',
    start_date: '2026-08-25',
    created_at: '2026-08-19T00:00:00Z',
    period_label: '8/25~8/29',
  });

  it('picks latest same-company 승인완료 before current start, not a peer company', () => {
    const hitechPrev = run({
      id: 'hitech-prev',
      start_date: '2026-08-18',
      created_at: '2026-08-10T00:00:00Z',
      period_label: '8/18~8/22',
    });
    const hitechOlder = run({
      id: 'hitech-older',
      start_date: '2026-08-11',
      created_at: '2026-08-03T00:00:00Z',
    });
    const jinnamNewer = run({
      id: 'jinnam',
      target_company_ids: ['co-jinnam'],
      start_date: '2026-08-20',
      created_at: '2026-08-18T00:00:00Z',
    });
    const picked = pickPreviousApprovedRun(current, [jinnamNewer, hitechPrev, hitechOlder]);
    expect(picked?.id).toBe('hitech-prev');
  });

  it('prefers same type over a newer different type', () => {
    const sameType = run({
      id: '정기-prev',
      type: '정기',
      start_date: '2026-08-11',
      created_at: '2026-08-04T00:00:00Z',
    });
    const newerSusi = run({
      id: '수시-newer',
      type: '수시',
      start_date: '2026-08-18',
      created_at: '2026-08-12T00:00:00Z',
    });
    expect(pickPreviousApprovedRun(current, [newerSusi, sameType])?.id).toBe('정기-prev');
  });

  it('skips deleted and non-approved', () => {
    const deleted = run({ id: 'del', is_deleted: true, start_date: '2026-08-18' });
    const draft = run({ id: 'draft', status: '작성중', start_date: '2026-08-18' });
    const ok = run({ id: 'ok', start_date: '2026-08-11' });
    expect(pickPreviousApprovedRun(current, [deleted, draft, ok])?.id).toBe('ok');
  });

  it('returns null when no overlapping company exists', () => {
    const other = run({
      id: 'other',
      target_company_ids: ['co-jinnam'],
      start_date: '2026-08-18',
    });
    expect(pickPreviousApprovedRun(current, [other])).toBeNull();
  });

  it('does not pick a later approved 회차 as 전회차 of an older draft', () => {
    const olderDraft = run({
      id: 'week3-draft',
      status: '작성중',
      start_date: '2026-08-17',
      created_at: '2026-08-11T00:00:00Z',
    });
    const laterApproved = run({
      id: 'week4-approved',
      start_date: '2026-08-24',
      created_at: '2026-08-19T00:00:00Z',
    });
    expect(pickPreviousApprovedRun(olderDraft, [laterApproved])).toBeNull();
  });

  it('does not pick self', () => {
    const self = run({ id: 'next', status: '승인완료', start_date: '2026-08-18' });
    expect(pickPreviousApprovedRun(self, [self])).toBeNull();
  });
});

describe('resolveExecutionFeedbackTarget', () => {
  const previous = run({
    id: 'prev',
    start_date: '2026-08-18',
    period_label: '금주 전회차',
  });
  const draftNext = run({
    id: 'next',
    status: '작성중',
    start_date: '2026-08-25',
    created_at: '2026-08-19T00:00:00Z',
  });

  it('uses 전회차 while 차주 is still being written', () => {
    expect(resolveExecutionFeedbackTarget({
      current: draftNext,
      previous,
      today: '2026-08-19',
    })?.id).toBe('prev');
  });

  it('keeps 전회차 after 차주 approval if work week has not started', () => {
    expect(resolveExecutionFeedbackTarget({
      current: { ...draftNext, status: '승인완료' },
      previous,
      today: '2026-08-21',
    })?.id).toBe('prev');
  });

  it('switches to this run once approved and start_date is today or past', () => {
    expect(resolveExecutionFeedbackTarget({
      current: { ...draftNext, status: '승인완료' },
      previous,
      today: '2026-08-25',
    })?.id).toBe('next');
  });

  it('first cycle: empty until approved, then this run', () => {
    expect(resolveExecutionFeedbackTarget({
      current: draftNext,
      previous: null,
      today: '2026-08-19',
    })).toBeNull();
    expect(resolveExecutionFeedbackTarget({
      current: { ...draftNext, status: '승인완료' },
      previous: null,
      today: '2026-08-19',
    })?.id).toBe('next');
  });
});

describe('resolvePrintFeedbackRun', () => {
  const previous = run({ id: 'prev', start_date: '2026-08-18' });
  const next = run({
    id: 'next',
    status: '작성중',
    start_date: '2026-08-25',
  });

  it('print 금주 stays on 전회차 even after this run is in its work week', () => {
    expect(resolvePrintFeedbackRun({
      current: { ...next, status: '승인완료' },
      previous,
    })?.id).toBe('prev');
  });

  it('first cycle prints this run after approval', () => {
    expect(resolvePrintFeedbackRun({ current: next, previous: null })).toBeNull();
    expect(resolvePrintFeedbackRun({
      current: { ...next, status: '승인완료' },
      previous: null,
    })?.id).toBe('next');
  });
});

describe('isManagedResidualHigh', () => {
  it('is only 개선 후 상', () => {
    expect(isManagedResidualHigh({ improved_risk_grade: '상' })).toBe(true);
    expect(isManagedResidualHigh({ improved_risk_grade: '중' })).toBe(false);
  });
});
