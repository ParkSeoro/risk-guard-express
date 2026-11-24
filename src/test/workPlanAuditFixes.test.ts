import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { computeWorkPlanNextActions } from '@/lib/workPlanNextActions';
import { buildWorkPlanReviewSummary } from '@/lib/workPlanReviewSummary';
import { LEGAL_CALC_SECTION_KEY } from '@/lib/workPlanLegalCalcGate';

describe('Work-Plan Code & DB Audit Regression Fixes', () => {
  it('clears legal-calc blocker in nextActions once excavation legalCalcSnapshot passes', () => {
    const missing = computeWorkPlanNextActions({
      workType: 'excavation',
      startDate: '2026-11-24',
      endDate: '2026-11-30',
      authorUserId: 'user-1',
      legalCalcSnapshot: null,
      mandatoryMissing: 0,
    });
    expect(missing.some((a) => a.tab === 'calculator')).toBe(true);

    const passed = computeWorkPlanNextActions({
      workType: 'excavation',
      startDate: '2026-11-24',
      endDate: '2026-11-30',
      authorUserId: 'user-1',
      legalCalcSnapshot: {
        updatedAt: '2026-11-24T00:00:00Z',
        entries: [{ id: 'excavation_slope', label: '굴착 사면 안전율', verdict: 'pass', conclusion: '적합' }],
      },
      mandatoryMissing: 0,
    });
    expect(passed).toEqual([]);

    const failed = computeWorkPlanNextActions({
      workType: 'excavation',
      startDate: '2026-11-24',
      endDate: '2026-11-30',
      authorUserId: 'user-1',
      legalCalcSnapshot: {
        updatedAt: '2026-11-24T00:00:00Z',
        entries: [{ id: 'excavation_slope', label: '굴착 사면 안전율', verdict: 'fail', conclusion: '부적합' }],
      },
      mandatoryMissing: 0,
    });
    expect(failed.some((a) => a.tab === 'calculator' && a.label.includes('부적합'))).toBe(true);
  });

  it('parses real DB work_plans.sections JSONB array and checks _legal_calc for excavation', () => {
    const sectionsArray = [
      { key: 'overview', content: '{"work_name":"터파기"}' },
      { key: 'geology', content: '사질토' },
      { key: 'method', content: '단계 굴착' },
      { key: 'shoring', content: 'H-pile' },
      { key: 'spoil', content: '덤프 반출' },
      { key: 'contact', content: '무전기' },
      { key: 'commander', content: '김지휘' },
      { key: 'risk', content: '붕괴 방지' },
      { key: 'emergency', content: '대피로 확보' },
      {
        key: LEGAL_CALC_SECTION_KEY,
        content: JSON.stringify({
          updatedAt: '2026-11-24T00:00:00Z',
          entries: [{ id: 'excavation_slope', label: '굴착 사면 안전율', verdict: 'pass', conclusion: '적합' }],
        }),
      },
    ];

    const summary = buildWorkPlanReviewSummary({
      workType: 'excavation',
      sections: sectionsArray,
      attachments: [
        { attachment_key: 'biz_license', name: '사업자등록증', is_mandatory: true, file_url: 'https://x/1.pdf', category: 'legal' },
      ],
    });
    expect(summary.overall).toBe('ok');
    expect(summary.signals.find((s) => s.id === 'annex4')?.value).toBe('9/9');
    expect(summary.signals.find((s) => s.id === 'rigging')?.label).toBe('법정계산');
    expect(summary.signals.find((s) => s.id === 'rigging')?.light).toBe('ok');
  });

  it('queries real work_plans.sections column (never nonexistent content) in ApprovalDocPreviewDialog', () => {
    const src = readFileSync(
      resolve(__dirname, '../components/approval/ApprovalDocPreviewDialog.tsx'),
      'utf-8',
    );
    expect(src).toContain('.select("work_type, sections")');
    expect(src).not.toContain('.select("work_type, content")');
  });
});
