import { describe, expect, it } from 'vitest';
import {
  WEEKLY_LINK_CANDIDATE_SELECT,
  companyTargetsOverlap,
  executionFeedbackCount,
  formatPreviousRunOptionLabel,
  isManagedResidualHigh,
  listManualPreviousCandidates,
  pickPreviousApprovedRun,
  resolveExecutionFeedbackTarget,
  resolvePreviousRun,
  resolvePrintFeedbackRun,
  unresolvedFeedbackCount,
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

  it('links empty-company 수시 to the previous 수시, not a newer 상시 peer', () => {
    const week9 = run({
      id: 'week9-susi',
      type: '수시',
      status: '승인완료',
      start_date: '2026-08-31',
      created_at: '2026-08-26T06:21:01Z',
      target_company_ids: [],
    });
    const week8Susi = run({
      id: 'week8-susi',
      type: '수시',
      start_date: '2026-08-24',
      created_at: '2026-08-19T01:10:53Z',
      target_company_ids: [],
    });
    const week8Always = run({
      id: 'week8-always',
      type: '상시',
      start_date: '2026-08-24',
      created_at: '2026-08-24T08:54:03Z',
      target_company_ids: [],
    });
    expect(pickPreviousApprovedRun(week9, [week8Always, week8Susi])?.id).toBe('week8-susi');
  });

  it('falls back to another type when same-type approved runs are not earlier', () => {
    const currentRegular = run({
      id: '정기-next',
      type: '정기',
      status: '작성중',
      start_date: '2026-09-07',
      created_at: '2026-09-01T00:00:00Z',
    });
    const laterRegular = run({
      id: '정기-later',
      type: '정기',
      start_date: '2026-09-14',
      created_at: '2026-09-08T00:00:00Z',
    });
    const earlierAlways = run({
      id: '상시-prev',
      type: '상시',
      start_date: '2026-08-31',
      created_at: '2026-08-25T00:00:00Z',
    });
    expect(pickPreviousApprovedRun(currentRegular, [laterRegular, earlierAlways])?.id).toBe('상시-prev');
  });
});

describe('resolvePreviousRun / listManualPreviousCandidates', () => {
  const current = run({
    id: 'next',
    status: '작성중',
    start_date: '2026-09-07',
    created_at: '2026-09-01T00:00:00Z',
    target_company_ids: ['co-hitech'],
  });
  const emptyApproved = run({
    id: 'empty-approved',
    start_date: '2026-08-31',
    created_at: '2026-08-25T00:00:00Z',
    target_company_ids: [],
    period_label: '9월 1주차 공란',
  });
  const pending = run({
    id: 'pending',
    status: '결재진행',
    start_date: '2026-08-31',
    created_at: '2026-08-26T00:00:00Z',
    period_label: '9월 1주차 결재중',
  });
  const matching = run({
    id: 'match',
    start_date: '2026-08-24',
    created_at: '2026-08-20T00:00:00Z',
    period_label: '8월 4주차',
  });

  it('does not auto-link empty-company 승인완료 to a filled-company draft', () => {
    expect(pickPreviousApprovedRun(current, [emptyApproved, matching])?.id).toBe('match');
    expect(pickPreviousApprovedRun(current, [emptyApproved])).toBeNull();
  });

  it('lets a manual override pick a company-mismatch or 결재진행 회차', () => {
    expect(resolvePreviousRun(current, [emptyApproved, matching], emptyApproved.id)?.id).toBe('empty-approved');
    expect(resolvePreviousRun(current, [pending, matching], pending.id)?.id).toBe('pending');
  });

  it('falls back to auto when override is missing or self', () => {
    expect(resolvePreviousRun(current, [matching, emptyApproved], 'nope')?.id).toBe('match');
    expect(resolvePreviousRun(current, [matching], current.id)?.id).toBe('match');
  });

  it('lists 결재진행 in the picker and prefers overlapping companies', () => {
    const ids = listManualPreviousCandidates(current, [emptyApproved, pending, matching]).map((c) => c.id);
    expect(ids).toEqual(['pending', 'match', 'empty-approved']);
  });

  it('labels include 관리대상 count', () => {
    expect(formatPreviousRunOptionLabel(matching, 19)).toContain('관리대상 19건');
    expect(formatPreviousRunOptionLabel(matching, 19)).toContain('8월 4주차');
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

describe('WEEKLY_LINK_CANDIDATE_SELECT', () => {
  it('does not request schema-optional columns that would blank the 금주 tab', () => {
    expect(WEEKLY_LINK_CANDIDATE_SELECT).not.toMatch(/feedback_status/);
    expect(WEEKLY_LINK_CANDIDATE_SELECT).toMatch(/target_company_ids/);
    expect(WEEKLY_LINK_CANDIDATE_SELECT).toMatch(/\btype\b/);
  });
});

describe('executionFeedbackCount', () => {
  it('counts all 전회차 photos while the 차주 week has not started', () => {
    expect(executionFeedbackCount({
      executionId: 'prev',
      previousId: 'prev',
      currentId: 'next',
      previousFeedbackCount: 2,
      currentFeedbackCount: 0,
    })).toBe(2);
  });

  it('does not hide completed photos from the tab badge', () => {
    expect(unresolvedFeedbackCount([{ status: '완료' }, { status: '완료' }])).toBe(0);
    expect(executionFeedbackCount({
      executionId: 'prev',
      previousId: 'prev',
      currentId: 'next',
      previousFeedbackCount: 2,
      currentFeedbackCount: 0,
    })).toBe(2);
  });

  it('uses this run after it is the execution target', () => {
    expect(executionFeedbackCount({
      executionId: 'next',
      previousId: 'prev',
      currentId: 'next',
      previousFeedbackCount: 2,
      currentFeedbackCount: 0,
    })).toBe(0);
  });
});
