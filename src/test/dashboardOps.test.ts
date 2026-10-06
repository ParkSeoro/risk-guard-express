import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildAttentionItems,
  countOnSite,
  summarizePermits,
  summarizeWorkPlans,
} from '@/lib/dashboardOps';
import { formatSiteLabel } from '@/lib/legalForms/patrolLog';

describe('dashboardOps', () => {
  it('summarizes permit statuses', () => {
    const s = summarizePermits([
      { status: '작성중' },
      { status: '결재중' },
      { status: '승인완료' },
      { status: '종료대기' },
      { status: '반려' },
    ]);
    expect(s).toEqual({
      draft: 1,
      inApproval: 1,
      active: 1,
      closurePending: 1,
      rejected: 1,
      total: 5,
    });
  });

  it('builds attention with critical first', () => {
    const items = buildAttentionItems({
      myPendingApprovals: 2,
      permitDraft: 1,
      permitInApproval: 0,
      permitClosurePending: 3,
      permitRejected: 0,
      todoOpenDaily: 0,
      zoneAlerts: 0,
      safetyCostViolations: 0,
      raFeedbackUnresolved: 0,
      residualHigh: 5,
      showSafetyCost: true,
      showZone: true,
    });
    expect(items[0].severity).toBe('critical');
    expect(items.map((i) => i.id).slice(0, 2)).toEqual(
      expect.arrayContaining(['approvals', 'permit-closure']),
    );
    expect(items.map((i) => i.id)).not.toContain('permit-draft');
    expect(items.map((i) => i.id)).not.toContain('ra-residual');
  });

  it('summarizes work plan statuses', () => {
    const s = summarizeWorkPlans([
      { status: '작성중' },
      { status: '결재중' },
      { status: '승인완료' },
      { status: '반려' },
      { status: '만료' },
    ]);
    expect(s).toEqual({
      draft: 1,
      inApproval: 1,
      approved: 1,
      rejected: 1,
      total: 5,
    });
  });

  it('counts on-site workers', () => {
    const c = countOnSite([
      { entry_at: '2026-08-07T08:00:00', exit_at: null },
      { entry_at: '2026-08-07T08:00:00', exit_at: '2026-08-07T17:00:00' },
    ]);
    expect(c.todayEntries).toBe(2);
    expect(c.onSiteWorkers).toBe(1);
  });
});

describe('dashboard site label', () => {
  it('shows one name when project and site are the same', () => {
    expect(formatSiteLabel('GSC 여수 H2/LCO2 PJT', 'GSC 여수 H2/LCO2 PJT'))
      .toBe('GSC 여수 H2/LCO2 PJT');
    const src = readFileSync('src/pages/Dashboard.tsx', 'utf8');
    expect(src).toContain('formatSiteLabel(currentProject.name, currentProject.site_name)');
    expect(src).not.toContain('${currentProject.site_name} · ${currentProject.name}');
    expect(src).toContain('오늘 확인할 일이 없습니다');
    expect(src).toContain('현장 숫자');
    expect(src).toContain('AI 어시스턴트');
    expect(src).toContain('허가서 발행 현황');
    expect(src).toContain('filterRunsByCompanyScope');
    expect(src).toContain('applyCompanyFilter(wq)');
    expect(src).not.toContain('function QuickStartCards');
    expect(src).not.toContain('법적업무 수행률');
    const weatherAt = src.indexOf('<WeatherSummaryCard');
    const attentionAt = src.indexOf('오늘 확인할 일');
    const tbmAt = src.indexOf('금일 TBM');
    const aiAt = src.lastIndexOf('AI 어시스턴트');
    expect(weatherAt).toBeGreaterThan(-1);
    expect(attentionAt).toBeGreaterThan(weatherAt);
    expect(aiAt).toBeGreaterThan(tbmAt);
  });
});
