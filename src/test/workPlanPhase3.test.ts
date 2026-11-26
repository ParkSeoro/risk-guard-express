import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  buildWorkPlanReviewSummary,
  formatAttachmentRevisionNote,
} from '@/lib/workPlanReviewSummary';
import { WORK_PLAN_TYPES, getWorkPlanType } from '@/lib/workPlanTemplates';
import { emptyLegalRiskRows, normalizeRiskToLegalSlots } from '@/lib/workPlanLegalRisk';

describe('Phase 3: Reviewer 1-Minute Summary & Annex 4 Additive Sections', () => {
  it('computes all-ok summary for a complete heavy_lifting work plan', () => {
    const filledRisk = JSON.stringify(
      normalizeRiskToLegalSlots(
        emptyLegalRiskRows().map((r) => ({ ...r, measure: `${r.hazard} 방지 대책` })),
      ),
    );
    const summary = buildWorkPlanReviewSummary({
      workType: 'heavy_lifting',
      content: {
        overview: '50t 크레인 철골 인양',
        method: '절차 완료',
        risk: filledRisk,
        route: '서측 진입로',
        commander: '홍길동',
        signal: '무전기 CH 3',
        emergency: '비상연락망 가동',
      },
      rigging: {
        load_weight: 5,
        working_radius: 10,
        boom_length: 20,
        crane_model: '50T',
        crane_capacity: 50,
        rated_capacity: 20,
        safety_factor: 5.5,
        sling_material_type: 'wire_rope',
        wire_diameter_mm: 24,
        sling_count: 2,
        sling_angle_deg: 60,
        shackle_inch: '1-1/4',
        shackle_qty: 2,
        equipment_ok: 'O.K',
        sling_ok: 'O.K',
        shackle_ok: 'O.K',
      },
      attachments: [
        { attachment_key: 'biz_license', name: '사업자등록증', is_mandatory: true, file_url: 'https://x/1.pdf', category: 'legal' },
        { attachment_key: 'insurance_cert', name: '보험가입증명서', is_mandatory: true, file_url: 'https://x/2.pdf', category: 'legal' },
      ],
    });

    expect(summary.isArticle38).toBe(true);
    expect(summary.overall).toBe('ok');
    expect(summary.signals.find((s) => s.id === 'attachments')?.light).toBe('ok');
    expect(summary.signals.find((s) => s.id === 'annex4')?.light).toBe('ok');
    expect(summary.signals.find((s) => s.id === 'rigging')?.light).toBe('ok');
    expect(summary.signals.find((s) => s.id === 'rigging')?.value).toContain('25%');
  });

  it('flags missing mandatory attachments, incomplete 5대 위험, and NG rigging as fail', () => {
    const summary = buildWorkPlanReviewSummary({
      workType: 'heavy_lifting',
      content: { overview: '개요만 있음', risk: JSON.stringify(emptyLegalRiskRows()) },
      rigging: null,
      attachments: [
        { attachment_key: 'biz_license', name: '사업자등록증', is_mandatory: true, file_url: null, category: 'legal' },
      ],
    });

    expect(summary.overall).toBe('fail');
    expect(summary.signals.find((s) => s.id === 'attachments')?.light).toBe('fail');
    expect(summary.signals.find((s) => s.id === 'annex4')?.light).toBe('fail');
    expect(summary.signals.find((s) => s.id === 'rigging')?.light).toBe('fail');
  });

  it('marks rigging as na for non-rigging work types', () => {
    const summary = buildWorkPlanReviewSummary({
      workType: 'excavation',
      content: {
        overview: '터파기',
        geology: '사질토',
        method: '단계 굴착',
        shoring: 'H-pile',
        spoil: '덤프 반출',
        contact: '무전기',
        commander: '김지휘',
        risk: '붕괴 방지',
        emergency: '대피로 확보',
      },
      attachments: [
        { attachment_key: 'biz_license', name: '사업자등록증', is_mandatory: true, file_url: 'https://x/1.pdf', category: 'legal' },
      ],
    });

    expect(summary.signals.find((s) => s.id === 'rigging')?.light).toBe('na');
    expect(summary.overall).toBe('ok');
  });

  it('formats attachment revision request notes cleanly', () => {
    expect(formatAttachmentRevisionNote('정기검사증')).toContain('[첨부 보완 요청] 정기검사증');
    expect(formatAttachmentRevisionNote('정기검사증', '유효기간 만료')).toBe(
      '[첨부 보완 요청] 정기검사증: 유효기간 만료',
    );
  });

  it('adds Article 38 Annex 4 sections strictly additively without duplicate or dropped legacy keys', () => {
    const expectedAdditive: Record<string, string[]> = {
      heavy_lifting: ['overview', 'equipment', 'method', 'risk', 'rigging', 'route', 'commander', 'signal', 'emergency'],
      tunnel: ['overview', 'geology', 'method', 'support_water', 'ventilation', 'risk', 'monitoring', 'emergency'],
      demolition: ['overview', 'survey', 'method', 'sequence_protect', 'commander', 'risk', 'emergency'],
      chemical: ['overview', 'survey', 'isolation', 'commander', 'method', 'risk', 'emergency'],
      electrical: ['overview', 'approach', 'loto', 'supervisor', 'method', 'risk', 'emergency'],
      bridge: ['overview', 'survey', 'method', 'rigging', 'traffic_control', 'commander', 'risk', 'emergency'],
      quarry: ['overview', 'survey', 'method', 'bench_slope', 'safety_zone', 'risk', 'emergency'],
    };

    for (const [typeId, requiredKeys] of Object.entries(expectedAdditive)) {
      const tpl = getWorkPlanType(typeId);
      expect(tpl, typeId).toBeTruthy();
      const keys = tpl!.templateSections.map((s) => s.key);
      for (const k of requiredKeys) {
        expect(keys, `${typeId} missing ${k}`).toContain(k);
      }
    }

    // No template may have duplicate section keys
    for (const t of WORK_PLAN_TYPES) {
      const keys = t.templateSections.map((s) => s.key);
      expect(new Set(keys).size, `duplicate section key in ${t.id}`).toBe(keys.length);
    }
  });

  it('keeps split-view and reviewer mode wired in ApprovalDocPreviewDialog', () => {
    const src = readFileSync(
      resolve(__dirname, '../components/approval/ApprovalDocPreviewDialog.tsx'),
      'utf-8',
    );
    expect(src).toContain('buildWorkPlanReviewSummary');
    expect(src).toContain('lg:grid-cols-[1fr_440px]');
    expect(src).toContain('reviewerMode');
  });

  it('flags expired and expiring-soon attachment dates in reviewer 1-minute summary', () => {
    const expiredSummary = buildWorkPlanReviewSummary({
      workType: 'excavation',
      todayKst: '2026-11-26',
      content: {
        overview: '터파기',
        geology: '사질토',
        method: '단계 굴착',
        shoring: 'H-pile',
        spoil: '덤프 반출',
        contact: '무전기',
        commander: '김지휘',
        risk: '붕괴 방지',
        emergency: '대피로 확보',
      },
      attachments: [
        {
          attachment_key: 'safety_inspection',
          name: '안전검사증',
          is_mandatory: true,
          file_url: 'https://x/1.pdf',
          category: 'legal',
          doc_expiry_date: '2026-10-01',
        },
        {
          attachment_key: 'insurance_cert',
          name: '보험가입증명서',
          is_mandatory: true,
          file_url: 'https://x/2.pdf',
          category: 'legal',
          doc_expiry_date: '2027-05-01',
        },
      ],
    });
    expect(expiredSummary.overall).toBe('fail');
    const expSig = expiredSummary.signals.find((s) => s.id === 'expiry');
    expect(expSig?.light).toBe('fail');
    expect(expSig?.value).toBe('만료 1건');
    expect(expSig?.detail).toContain('안전검사증(2026-10-01)');

    const soonSummary = buildWorkPlanReviewSummary({
      workType: 'excavation',
      todayKst: '2026-11-26',
      content: {
        overview: '터파기',
        geology: '사질토',
        method: '단계 굴착',
        shoring: 'H-pile',
        spoil: '덤프 반출',
        contact: '무전기',
        commander: '김지휘',
        risk: '붕괴 방지',
        emergency: '대피로 확보',
      },
      attachments: [
        {
          attachment_key: 'insurance_cert',
          name: '보험가입증명서',
          is_mandatory: true,
          file_url: 'https://x/2.pdf',
          category: 'legal',
          doc_expiry_date: '2026-12-10',
        },
      ],
    });
    expect(soonSummary.overall).toBe('warn');
    expect(soonSummary.signals.find((s) => s.id === 'expiry')?.light).toBe('warn');
  });
});
