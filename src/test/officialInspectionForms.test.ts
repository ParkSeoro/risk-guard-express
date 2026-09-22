import { describe, expect, it } from 'vitest';
import { buildChecklist } from '@/lib/inspectionTemplates';
import {
  OFFICIAL_APPROVAL_SEED_STEPS,
  OFFICIAL_APPROVAL_STEP_TEMPLATES,
  buildOfficialInspectionHtml,
  extraOfficialRows,
  officialChecklist,
  officialItemCount,
  gradeToResult,
  isApprovalInspection,
  isOfficialInspection,
  officialGradeScale,
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
  });
});
