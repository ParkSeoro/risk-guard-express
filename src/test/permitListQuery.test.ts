import { describe, expect, it } from 'vitest';
import {
  addCalendarDaysYmd,
  closureListProgress,
  filterPermitsForList,
  matchesPermitSearch,
  matchesPermitStatusFilter,
  permitListDateFrom,
  resolvePermitApprovedByName,
  resolvePermitSubmittedByName,
} from '@/lib/permitListQuery';

describe('permit list date window', () => {
  it('14d is inclusive 14 calendar days ending today', () => {
    expect(addCalendarDaysYmd('2026-08-13', -13)).toBe('2026-07-31');
    expect(permitListDateFrom('14d', '2026-08-13')).toBe('2026-07-31');
    expect(permitListDateFrom('month', '2026-08-13')).toBe('2026-08-01');
    expect(permitListDateFrom('all', '2026-08-13')).toBeNull();
  });
});

describe('permit list status/search', () => {
  it('maps 종료대기 to closure_pending', () => {
    expect(matchesPermitStatusFilter('종료대기', 'closure_pending')).toBe(true);
    expect(matchesPermitStatusFilter('승인', 'issued')).toBe(true);
    expect(matchesPermitStatusFilter('작성중', 'issued')).toBe(false);
  });

  it('searches name, location, company', () => {
    const p = {
      work_description: '가로등 기초 및 ELP 관련 매설 작업',
      location: 'GSC 현장 내',
      contractor_company: '정엔지니어링',
    };
    expect(matchesPermitSearch(p, 'ELP')).toBe(true);
    expect(matchesPermitSearch(p, '정엔')).toBe(true);
    expect(matchesPermitSearch(p, '없는단어')).toBe(false);
  });

  it('defaults 14d window and keeps older out', () => {
    const rows = [
      { id: 'a', status: '종료대기', permit_date: '2026-08-12', work_description: '가로등' },
      { id: 'b', status: '승인', permit_date: '2026-06-01', work_description: '옛 작업' },
    ];
    const filtered = filterPermitsForList(rows, {
      period: '14d',
      statusFilter: 'all',
      search: '',
      today: '2026-08-13',
    });
    expect(filtered.map((r) => r.id)).toEqual(['a']);
  });
});

describe('list name fallback + closure progress', () => {
  const rows = [
    { entity_id: 'p1', position: 'contractor_supervisor', status: '승인', approver_name: '박현호' },
    { entity_id: 'p1', position: 'owner_sm', status: '승인', approver_name: '박서로' },
    { entity_id: 'p1', position: 'closure_supervisor', status: '승인', approver_name: '박현호' },
    { entity_id: 'p1', position: 'closure_sm', status: '진행중', approver_name: '박서로' },
  ];

  it('fills blank submitted/approved names from issuance rows', () => {
    expect(resolvePermitSubmittedByName({ id: 'p1', submitted_by_name: null }, rows)).toBe('박현호');
    expect(resolvePermitApprovedByName({ id: 'p1', approved_by_name: '' }, rows)).toBe('박서로');
    expect(resolvePermitSubmittedByName({ id: 'p1', submitted_by_name: '이미있음' }, rows)).toBe('이미있음');
  });

  it('shows supervisor done + SM waiting on 종료대기', () => {
    const prog = closureListProgress('p1', rows);
    expect(prog?.supervisorDone).toBe(true);
    expect(prog?.smWaiting).toBe(true);
    expect(prog?.label).toContain('관리감독자 확인됨');
    expect(prog?.label).toContain('발주처 SM 종료 승인 대기');
  });
});
