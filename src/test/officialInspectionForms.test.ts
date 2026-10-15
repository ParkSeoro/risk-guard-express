import { describe, expect, it } from 'vitest';
import { buildChecklist } from '@/lib/inspectionTemplates';
import {
  OFFICIAL_APPROVAL_SEED_STEPS,
  OFFICIAL_APPROVAL_STEP_TEMPLATES,
  buildOfficialInspectionHtml,
  extraOfficialRows,
  formatOfficialApprovalStamp,
  officialChecklist,
  officialItemCount,
  gradeToResult,
  isApprovalInspection,
  isOfficialInspection,
  officialGradeScale,
  splitOfficialApprovalSigners,
} from '@/lib/legalForms/officialInspectionForms';

describe('official inspection forms', () => {
  it('keeps existing types and adds the four paper forms', () => {
    expect(isOfficialInspection('pre_work')).toBe(false);
    expect(isOfficialInspection('patrol')).toBe(false);
    expect(isOfficialInspection('daily_sf006')).toBe(true);
    expect(isApprovalInspection('patrol')).toBe(true);
    expect(isApprovalInspection('height_sf008')).toBe(true);
    expect(isApprovalInspection('pre_work')).toBe(false);
  });

  it('snapshots official items without process addons', () => {
    expect(officialItemCount('daily_sf006')).toBe(28);
    expect(officialItemCount('equipment_sf007')).toBe(24);
    expect(officialItemCount('height_sf008')).toBe(25);
    expect(officialItemCount('facility_sf009')).toBe(24);
    expect(buildChecklist('daily_sf006', '고소작업')).toHaveLength(28);
    expect(buildChecklist('height_sf008', '고소작업').some((i) => i.code.startsWith('HGT-00'))).toBe(false);
    expect(buildChecklist('pre_work', '고소작업').some((i) => i.code === 'PRE-001')).toBe(true);
  });

  it('maps 불량 only to fail', () => {
    expect(gradeToResult('good')).toBe('pass');
    expect(gradeToResult('fair')).toBe('pass');
    expect(gradeToResult('poor')).toBe('fail');
    expect(gradeToResult('na')).toBe('na');
    expect(officialGradeScale('daily_sf006')).toBe('two');
    expect(officialGradeScale('facility_sf009')).toBe('four');
  });

  it('seeds 작성자 + 최종결재(승인), 작성자가 승인/합의를 고른다', () => {
    expect(OFFICIAL_APPROVAL_SEED_STEPS[0]).toEqual({ label: '작성자', position: 'contractor_supervisor' });
    expect(OFFICIAL_APPROVAL_SEED_STEPS[1]).toEqual({ label: '최종결재(승인)', position: 'contractor_site_director' });
    expect(OFFICIAL_APPROVAL_STEP_TEMPLATES.map((t) => t.step_label)).toEqual([
      '작성자',
      '최종결재(승인)',
      '최종결재(합의)',
    ]);
    expect(OFFICIAL_APPROVAL_STEP_TEMPLATES.find((t) => t.step_label === '최종결재(승인)')).toMatchObject({
      openPool: true,
      badgeLabel: '승인',
    });
    expect(OFFICIAL_APPROVAL_STEP_TEMPLATES.find((t) => t.step_label === '최종결재(합의)')).toMatchObject({
      position: 'consent',
      openPool: true,
      badgeLabel: '합의',
    });
    expect(officialChecklist('facility_sf009').some((i) => i.number === 9 && i.section === '위험물 저장소')).toBe(true);
  });

  it('prints extra checklist rows after the paper template', () => {
    const rows = [
      { code: 'FAC-01', label: '비계 고정', grade: 'good' as const, note: '' },
      { code: 'EXTRA-1', label: '임시 개구부 덮개', grade: 'poor' as const, note: '즉시 조치' },
    ];
    expect(extraOfficialRows('facility_sf009', rows)).toHaveLength(1);
    const html = buildOfficialInspectionHtml({
      type: 'facility_sf009',
      location: 'A동',
      inspectorName: '홍길동',
      inspectedAt: '2026-09-22',
      payload: {},
      rows,
    });
    expect(html).toContain('추가 항목');
    expect(html).toContain('임시 개구부 덮개');
    expect(html).toContain('즉시 조치');
    expect(html).toContain('Doc. No. LST-000000-SF009');
    expect(html).toContain('Rev. A');
    expect(html).toContain('시설물 안전점검표');
  });

  it('prints ALK signature table footer for SF007–009 (not DIG text lines)', () => {
    const html = buildOfficialInspectionHtml({
      type: 'height_sf008',
      location: 'B동',
      inspectorName: '김점검',
      inspectedAt: '2026-10-13',
      payload: {
        action_notes: '비계 보강 완료',
        dig_signers: ['홍ALK', '', ''],
        contractor_signers: ['이업체', '박업체', ''],
      },
      rows: [],
    });
    expect(html).toContain('ALK 고소작업수칙');
    expect(html).toContain('class="action-box"');
    expect(html).toContain('비계 보강 완료');
    expect(html).toContain('ALK 서명');
    expect(html).toContain('공사업체 서명');
    expect(html).toContain('홍ALK');
    expect(html).toContain('이업체');
    expect(html).not.toContain('DIG 서명');
    expect(html).not.toMatch(/DIG 고소작업수칙/);
    expect(html).toContain('class="signers"');
  });

  it('fills ALK from 최종결재 and the contractor row from 작성자', () => {
    const approvedAt = '2026-10-14T06:30:00.000Z';
    expect(formatOfficialApprovalStamp(approvedAt, '승인')).toBe('2026.10.14 15:30');
    const html = buildOfficialInspectionHtml({
      type: 'facility_sf009',
      location: '저장소',
      inspectorName: '김점검',
      inspectedAt: '2026-10-14',
      payload: {
        dig_signers: ['홍ALK', '', ''],
        contractor_signers: ['직접입력', '', ''],
      },
      approvals: [
        {
          step: '작성자',
          step_order: 1,
          approver_name: '차강찬',
          company_name: '진남토건',
          status: '승인',
          approved_at: '2026-10-14T05:00:00.000Z',
          approval_version: 2,
          company_type: 'contractor',
        },
        {
          step: '최종결재(승인)',
          step_order: 2,
          approver_name: '박서로',
          company_name: '에어리퀴드코리아',
          status: '승인',
          approved_at: approvedAt,
          approval_version: 2,
          company_type: 'gc',
        },
        {
          step: '최종결재(승인)',
          step_order: 2,
          approver_name: '이전결재',
          company_name: '옛회사',
          status: '승인',
          approved_at: approvedAt,
          approval_version: 1,
        },
        {
          step: '작성자',
          step_order: 1,
          approver_name: '취소됨',
          company_name: '취소회사',
          status: '취소',
          approval_version: 2,
        },
      ],
      rows: [],
    });
    const alk = html.slice(html.indexOf('ALK 서명'), html.indexOf('공사업체 서명'));
    const contractor = html.slice(html.indexOf('공사업체 서명'));
    expect(alk).toContain('박서로 · 에어리퀴드코리아 · 2026.10.14 15:30');
    expect(alk).not.toContain('홍ALK');
    expect(alk).not.toContain('이전결재');
    expect(contractor).toContain('차강찬 · 진남토건 · 2026.10.14 14:00');
    expect(contractor).not.toContain('직접입력');
    expect(contractor).not.toContain('취소됨');
  });

  it('keeps typed names when that side has no approval line, and shows 대기 before approval', () => {
    const split = splitOfficialApprovalSigners([
      {
        step: '작성자',
        step_order: 0,
        approver_name: '차강찬',
        company_name: '진남토건',
        status: '진행중',
        approval_version: 1,
      },
    ]);
    expect(split.contractor).toEqual(['차강찬 · 진남토건 · 대기']);
    expect(split.alk).toEqual([]);
    const html = buildOfficialInspectionHtml({
      type: 'equipment_sf007',
      location: '야적장',
      inspectorName: '김점검',
      inspectedAt: '2026-10-14',
      payload: { dig_signers: ['홍ALK', '', ''], contractor_signers: ['직접입력', '', ''] },
      approvals: [
        {
          step: '작성자',
          step_order: 0,
          approver_name: '차강찬',
          company_name: '진남토건',
          status: '진행중',
          approval_version: 1,
        },
      ],
      rows: [],
    });
    expect(html).toContain('홍ALK');
    expect(html).toContain('차강찬 · 진남토건 · 대기');
    expect(html).not.toContain('직접입력');
  });

  it('leaves the daily form footer unchanged when approvals exist', () => {
    const html = buildOfficialInspectionHtml({
      type: 'daily_sf006',
      location: '현장',
      inspectorName: '김점검',
      inspectedAt: '2026-10-14',
      payload: { findings: '정리정돈' },
      approvals: [
        {
          step: '최종결재(승인)',
          approver_name: '박서로',
          company_name: '에어리퀴드코리아',
          status: '승인',
          approved_at: '2026-10-14T06:30:00.000Z',
          approval_version: 1,
        },
      ],
      rows: [],
    });
    expect(html).toContain('정리정돈');
    expect(html).not.toContain('ALK 서명');
    expect(html).not.toContain('박서로');
  });

  it('puts a client company on ALK when the step label is neither 작성 nor 최종결재', () => {
    const split = splitOfficialApprovalSigners([
      {
        step: '결재',
        approver_name: '박서로',
        company_name: '에어리퀴드코리아',
        company_type: 'client',
        status: '승인',
        approved_at: '2026-10-14T06:30:00.000Z',
        approval_version: 1,
      },
      {
        step: '검토',
        approver_name: '차강찬',
        company_name: '진남토건',
        company_type: 'gc',
        status: '반려',
        approval_version: 1,
      },
    ]);
    expect(split.alk[0]).toContain('박서로 · 에어리퀴드코리아 · 2026.10.14 15:30');
    expect(split.contractor).toEqual(['차강찬 · 진남토건 · 반려']);
  });
});
