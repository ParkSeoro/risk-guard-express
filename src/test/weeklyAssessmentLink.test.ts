import { describe, expect, it } from 'vitest';
import {
  WEEKLY_LINK_CANDIDATE_SELECT,
  companyTargetsOverlap,
  effectiveCompanyIds,
  parseAssessmentFeedbackChain,
  executionFeedbackCount,
  formatPreviousRunOptionLabel,
  isManagedResidualHigh,
  assessmentCompanyChainMatch,
  isOwnCompanyRun,
  listManualPreviousCandidates,
  mergeFeedbackChainPrevious,
  pickPreviousApprovedRun,
  resolveExecutionFeedbackTarget,
  resolvePreviousRun,
  resolvePrintFeedbackRun,
  resolvePrintFeedbackSections,
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

  it('does not treat two blank company lists as the same company', () => {
    expect(companyTargetsOverlap([], [])).toBe(false);
    expect(companyTargetsOverlap(null, undefined)).toBe(false);
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

  it('links the same author company 수시 to the previous 수시, not a newer 상시 peer', () => {
    const week9 = run({
      id: 'week9-susi',
      type: '수시',
      status: '승인완료',
      start_date: '2026-08-31',
      created_at: '2026-08-26T06:21:01Z',
      target_company_ids: ['co-author'],
    });
    const week8Susi = run({
      id: 'week8-susi',
      type: '수시',
      start_date: '2026-08-24',
      created_at: '2026-08-19T01:10:53Z',
      target_company_ids: ['co-author'],
    });
    const week8Always = run({
      id: 'week8-always',
      type: '상시',
      start_date: '2026-08-24',
      created_at: '2026-08-24T08:54:03Z',
      target_company_ids: ['co-author'],
    });
    expect(pickPreviousApprovedRun(week9, [week8Always, week8Susi])?.id).toBe('week8-susi');
  });

  it('does not chain blank runs, and uses the author company when it is stamped', () => {
    const current = run({
      id: 'blank-next',
      status: '작성중',
      start_date: '2026-09-21',
      created_at: '2026-09-15T00:00:00Z',
      target_company_ids: [],
      author_user_id: 'user-daewoong',
    });
    const otherBlank = run({
      id: 'blank-other',
      start_date: '2026-09-14',
      target_company_ids: [],
      author_user_id: 'user-cheongwon',
    });
    expect(pickPreviousApprovedRun(current, [otherBlank])).toBeNull();
    const stampedCurrent = {
      ...current,
      target_company_ids: effectiveCompanyIds(current, { 'user-daewoong': 'co-daewoong' }),
    };
    const stampedOther = {
      ...otherBlank,
      target_company_ids: effectiveCompanyIds(otherBlank, { 'user-cheongwon': 'co-cheongwon' }),
    };
    const stampedSame = run({
      id: 'same-author',
      start_date: '2026-09-14',
      target_company_ids: effectiveCompanyIds(
        run({ id: 'prev', target_company_ids: [], author_user_id: 'user-daewoong' }),
        { 'user-daewoong': 'co-daewoong' },
      ),
    });
    expect(pickPreviousApprovedRun(stampedCurrent, [stampedOther, stampedSame])?.id).toBe('same-author');
  });

  it('keeps 대웅, 청원, and 진남 on separate chains and ignores a cross-company previous', () => {
    const daewoong02 = run({
      id: 'daewoong-02',
      type: '상시',
      status: '반려',
      start_date: '2026-10-12',
      created_at: '2026-10-02T04:41:55Z',
      target_company_ids: ['co-daewoong'],
    });
    const daewoong01 = run({
      id: 'daewoong-01',
      type: '상시',
      start_date: '2026-10-05',
      created_at: '2026-09-28T08:04:01Z',
      target_company_ids: ['co-daewoong'],
    });
    const daewoong09 = run({
      id: 'daewoong-09',
      type: '상시',
      start_date: '2026-09-21',
      created_at: '2026-09-14T07:23:56Z',
      target_company_ids: ['co-daewoong'],
    });
    const jinnam = run({
      id: 'jinnam-02',
      type: '상시',
      start_date: '2026-10-05',
      created_at: '2026-09-29T02:41:17Z',
      target_company_ids: ['co-jinnam'],
    });
    const cheongwon = run({
      id: 'cheongwon-01',
      type: '상시',
      start_date: '2026-10-05',
      created_at: '2026-09-28T23:33:49Z',
      target_company_ids: ['co-cheongwon'],
    });
    const pool = [jinnam, cheongwon, daewoong01, daewoong09];
    expect(pickPreviousApprovedRun(daewoong02, pool)?.id).toBe('daewoong-01');
    expect(pickPreviousApprovedRun(daewoong01, pool)?.id).toBe('daewoong-09');
    expect(pickPreviousApprovedRun(daewoong02, [jinnam, cheongwon])).toBeNull();
    expect(resolvePreviousRun(daewoong02, pool, 'cheongwon-01')?.id).toBe('daewoong-01');
    const sections = resolvePrintFeedbackSections({
      current: daewoong02,
      previous: daewoong01,
      previousOfPrevious: daewoong09,
      mode: 'assessment',
    });
    expect(sections.geumju?.id).toBe('daewoong-01');
    expect(sections.jeonhoe?.id).toBe('daewoong-09');
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

  it('keeps a same-company 결재진행 override and ignores a company mismatch', () => {
    expect(resolvePreviousRun(current, [emptyApproved, matching], emptyApproved.id)?.id).toBe('match');
    expect(resolvePreviousRun(current, [pending, matching], pending.id)?.id).toBe('pending');
  });

  it('falls back to auto when override is missing or self', () => {
    expect(resolvePreviousRun(current, [matching, emptyApproved], 'nope')?.id).toBe('match');
    expect(resolvePreviousRun(current, [matching], current.id)?.id).toBe('match');
  });

  it('auto-links the same author company when target tags differ', () => {
    const authors = { 'user-gc': 'co-hitech' };
    const current = run({
      id: 'next',
      status: '작성중',
      start_date: '2026-08-25',
      created_at: '2026-08-19T00:00:00Z',
      target_company_ids: ['co-hitech'],
      author_user_id: 'user-gc',
    });
    const taggedPartner = run({
      id: 'tagged-partner',
      start_date: '2026-08-18',
      created_at: '2026-08-10T00:00:00Z',
      target_company_ids: ['co-partner'],
      author_user_id: 'user-gc',
    });
    const otherAuthor = run({
      id: 'other-author',
      start_date: '2026-08-20',
      created_at: '2026-08-17T00:00:00Z',
      target_company_ids: ['co-jinnam'],
      author_user_id: 'user-jinnam',
    });
    expect(assessmentCompanyChainMatch(current, taggedPartner, authors)).toBe(true);
    expect(assessmentCompanyChainMatch(current, otherAuthor, { ...authors, 'user-jinnam': 'co-jinnam' })).toBe(false);
    expect(pickPreviousApprovedRun(current, [otherAuthor, taggedPartner], authors)?.id).toBe('tagged-partner');
  });

  it('lists only the same company, including 결재진행', () => {
    const ids = listManualPreviousCandidates(current, [emptyApproved, pending, matching]).map((c) => c.id);
    expect(ids).toEqual(['pending', 'match']);
  });

  it('lets the user pick an own-company run when auto has no target overlap', () => {
    const scope = {
      userId: 'user-gc',
      accessibleCompanyIds: ['co-hitech'],
      authorCompanyByUser: { 'user-gc': 'co-hitech', 'user-jinnam': 'co-jinnam' },
    };
    const current = run({
      id: 'next',
      status: '작성중',
      start_date: '2026-08-25',
      created_at: '2026-08-19T00:00:00Z',
      target_company_ids: ['co-hitech'],
      author_user_id: 'user-gc',
    });
    const ownTaggedElsewhere = run({
      id: 'own-elsewhere',
      status: '승인완료',
      start_date: '2026-08-18',
      created_at: '2026-08-10T00:00:00Z',
      target_company_ids: ['co-site-tag'],
      author_user_id: 'user-gc',
    });
    const peer = run({
      id: 'peer',
      status: '승인완료',
      start_date: '2026-08-18',
      created_at: '2026-08-11T00:00:00Z',
      target_company_ids: ['co-jinnam'],
      author_user_id: 'user-jinnam',
    });
    expect(isOwnCompanyRun(ownTaggedElsewhere, scope)).toBe(true);
    expect(isOwnCompanyRun(peer, scope)).toBe(false);
    const ids = listManualPreviousCandidates(current, [peer, ownTaggedElsewhere], scope).map((c) => c.id);
    expect(ids).toEqual(['own-elsewhere']);
    expect(resolvePreviousRun(current, [peer, ownTaggedElsewhere], 'own-elsewhere', scope, scope.authorCompanyByUser)?.id)
      .toBe('own-elsewhere');
  });

  it('does not clear an own-company previous when the chain lookup is empty', () => {
    const own = run({ id: 'own', target_company_ids: ['co-hitech'] });
    const peer = run({ id: 'peer', target_company_ids: ['co-jinnam'] });
    const accept = (row: { target_company_ids?: string[] | null }) =>
      (row.target_company_ids || []).includes('co-hitech');
    expect(mergeFeedbackChainPrevious({
      chain: { previousRunId: null, previousOfPreviousRunId: null, autoPreviousRunId: null },
      chainPrevious: null,
      chainAuto: null,
      localPrevious: own,
      localAuto: own,
      accept,
    }).previous?.id).toBe('own');
    expect(mergeFeedbackChainPrevious({
      chain: { previousRunId: 'peer', previousOfPreviousRunId: null, autoPreviousRunId: null },
      chainPrevious: peer,
      chainAuto: null,
      localPrevious: own,
      localAuto: own,
      accept,
    }).previous?.id).toBe('own');
  });

  it('labels include the company and 관리대상 count', () => {
    expect(formatPreviousRunOptionLabel({ ...matching, company_label: '청원산기(주)' }, 19)).toContain('청원산기(주)');
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

describe('resolvePrintFeedbackSections', () => {
  const older = run({ id: 'older', start_date: '2026-08-11', period_label: '전전주' });
  const previous = run({ id: 'prev', start_date: '2026-08-18', period_label: '전회차' });
  const next = run({
    id: 'next',
    status: '작성중',
    start_date: '2026-08-25',
    period_label: '차주',
  });

  it('assessment print: 금주=전회차, 전회차=그 이전', () => {
    const s = resolvePrintFeedbackSections({
      current: next,
      previous,
      previousOfPrevious: older,
    });
    expect(s.geumju?.id).toBe('prev');
    expect(s.jeonhoe?.id).toBe('older');
  });

  it('feedback approval print: this run is 금주, previous is 전회차', () => {
    const s = resolvePrintFeedbackSections({
      current: previous,
      previous: older,
      mode: 'feedback',
    });
    expect(s.geumju?.id).toBe('prev');
    expect(s.jeonhoe?.id).toBe('older');
  });
});

describe('parseAssessmentFeedbackChain', () => {
  it('reads the shared chain row and treats an empty payload as a failed lookup', () => {
    expect(parseAssessmentFeedbackChain([
      {
        previous_run_id: 'daewoong-01',
        previous_of_previous_run_id: 'daewoong-09',
        auto_previous_run_id: 'daewoong-01',
      },
    ])).toEqual({
      previousRunId: 'daewoong-01',
      previousOfPreviousRunId: 'daewoong-09',
      autoPreviousRunId: 'daewoong-01',
    });
    expect(parseAssessmentFeedbackChain([])).toBeNull();
    expect(parseAssessmentFeedbackChain(null)).toBeNull();
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
    expect(WEEKLY_LINK_CANDIDATE_SELECT).toMatch(/author_user_id/);
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
