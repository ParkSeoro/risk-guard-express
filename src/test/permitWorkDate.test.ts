import { describe, it, expect } from 'vitest';
import {
  todayKst,
  datePartFromDateTime,
  resolvePermitWorkDate,
  syncPermitDateFromWorkStart,
  permitValidityKind,
  shouldShowPermitValidityBadge,
  shouldShowPermitRejectionReason,
  resolvePermitCompanyName,
  canViewPermitInList,
  isUserInvolvedInPermit,
} from '@/lib/permitWorkDate';

describe('datePartFromDateTime', () => {
  it('parses datetime-local and date-only', () => {
    expect(datePartFromDateTime('2026-08-03T09:00')).toBe('2026-08-03');
    expect(datePartFromDateTime('2026-07-30')).toBe('2026-07-30');
  });

  it('returns null for empty', () => {
    expect(datePartFromDateTime(null)).toBeNull();
    expect(datePartFromDateTime('')).toBeNull();
  });
});

describe('resolvePermitWorkDate', () => {
  it('prefers form_data.work_start over permit_date', () => {
    expect(
      resolvePermitWorkDate({
        permit_date: '2026-07-30',
        form_data: { work_start: '2026-08-03T08:00' },
      }),
    ).toBe('2026-08-03');
  });

  it('falls back to work_start_at then permit_date', () => {
    expect(
      resolvePermitWorkDate({
        permit_date: '2026-07-30',
        work_start_at: '2026-08-01T00:00:00+09:00',
      }),
    ).toBe('2026-08-01');
    expect(resolvePermitWorkDate({ permit_date: '2026-07-30' })).toBe('2026-07-30');
  });
});

describe('syncPermitDateFromWorkStart', () => {
  it('uses work start date when present', () => {
    expect(syncPermitDateFromWorkStart('2026-08-03T10:00', '2026-07-30')).toBe('2026-08-03');
  });

  it('falls back to permit_date', () => {
    expect(syncPermitDateFromWorkStart('', '2026-07-30')).toBe('2026-07-30');
  });
});

describe('permitValidityKind', () => {
  it('compares against provided today', () => {
    expect(permitValidityKind('2026-07-29', '2026-07-30')).toBe('expired');
    expect(permitValidityKind('2026-07-30', '2026-07-30')).toBe('today');
    expect(permitValidityKind('2026-08-03', '2026-07-30')).toBe('scheduled');
  });
});

describe('shouldShowPermitValidityBadge', () => {
  it('only for issued/closed', () => {
    expect(shouldShowPermitValidityBadge('승인')).toBe(true);
    expect(shouldShowPermitValidityBadge('작성중')).toBe(false);
    expect(shouldShowPermitValidityBadge('반려')).toBe(false);
  });
});

describe('canViewPermitInList', () => {
  const involved = new Set(['rej-1']);

  it('hides drafts from non-author non-admin', () => {
    expect(
      canViewPermitInList(
        { id: 'd1', status: '작성중', created_by: 'author' },
        { userId: 'other', isPermitAdmin: false, involvedPermitIds: involved },
      ),
    ).toBe(false);
  });

  it('shows drafts to author and admin', () => {
    expect(
      canViewPermitInList(
        { id: 'd1', status: '작성중', created_by: 'author' },
        { userId: 'author', isPermitAdmin: false },
      ),
    ).toBe(true);
    expect(
      canViewPermitInList(
        { id: 'd1', status: '임시저장', created_by: 'author' },
        { userId: 'other', isPermitAdmin: true },
      ),
    ).toBe(true);
  });

  it('shows rejected to involved approver only (among non-authors)', () => {
    expect(
      canViewPermitInList(
        { id: 'rej-1', status: '반려', created_by: 'author' },
        { userId: 'other', isPermitAdmin: false, involvedPermitIds: involved },
      ),
    ).toBe(true);
    expect(
      canViewPermitInList(
        { id: 'rej-2', status: '반려', created_by: 'author' },
        { userId: 'other', isPermitAdmin: false, involvedPermitIds: involved },
      ),
    ).toBe(false);
  });

  it('shows issued to everyone in scope', () => {
    expect(
      canViewPermitInList(
        { id: 'ok', status: '승인', created_by: 'author' },
        { userId: 'other', isPermitAdmin: false },
      ),
    ).toBe(true);
  });
});

describe('isUserInvolvedInPermit', () => {
  it('true for author or approval line', () => {
    expect(isUserInvolvedInPermit({ id: 'p1', created_by: 'u1' }, { userId: 'u1' })).toBe(true);
    expect(
      isUserInvolvedInPermit({ id: 'p1', created_by: 'x' }, { userId: 'u2', involvedPermitIds: new Set(['p1']) }),
    ).toBe(true);
    expect(isUserInvolvedInPermit({ id: 'p1', created_by: 'x' }, { userId: 'u2', involvedPermitIds: new Set() })).toBe(false);
  });
});

describe('todayKst', () => {
  it('returns YYYY-MM-DD', () => {
    expect(todayKst()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('shouldShowPermitRejectionReason', () => {
  it('hides stale rejection on issued/approved permits', () => {
    expect(shouldShowPermitRejectionReason('승인', '첨부서류 누락')).toBe(false);
    expect(shouldShowPermitRejectionReason('발행완료', '반려')).toBe(false);
    expect(shouldShowPermitRejectionReason('결재중', '첨부서류 누락')).toBe(false);
  });

  it('shows only while currently rejected with a reason', () => {
    expect(shouldShowPermitRejectionReason('반려', '첨부서류 누락')).toBe(true);
    expect(shouldShowPermitRejectionReason('반려', '  ')).toBe(false);
    expect(shouldShowPermitRejectionReason('반려', null)).toBe(false);
  });
});

describe('resolvePermitCompanyName', () => {
  it('prefers contractor_company then form_data then company map', () => {
    expect(
      resolvePermitCompanyName({
        contractor_company: '청원산기(주)',
        company_id: 'co-1',
        form_data: { contractor_company: '다른회사' },
      }),
    ).toBe('청원산기(주)');
    expect(
      resolvePermitCompanyName({
        contractor_company: '',
        company_id: 'co-1',
        form_data: { applicant_company: '알파산업(주)' },
      }),
    ).toBe('알파산업(주)');
    expect(
      resolvePermitCompanyName(
        { contractor_company: null, company_id: 'co-1', form_data: {} },
        new Map([['co-1', '정엔지니어링(주)']]),
      ),
    ).toBe('정엔지니어링(주)');
  });
});
