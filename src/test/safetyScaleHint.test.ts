import { describe, expect, it } from 'vitest';
import { constructionPeriodUnderOneMonth, safetyScaleHint } from '@/lib/safetyScaleHint';

const EOK = 100_000_000;

describe('safetyScaleHint', () => {
  it('asks for an amount when the contract value is empty', () => {
    const hint = safetyScaleHint({ amount: 0, constructionType: '건축' });
    expect(hint.hasAmount).toBe(false);
    expect(hint.appointment).toContain('도급금액');
  });

  it('treats a subcontractor under 100억 as outside the appointment band and inside technical guidance', () => {
    const hint = safetyScaleHint({
      amount: 80 * EOK,
      constructionType: '건축',
      relationSubcontractor: true,
      periodStart: '2026-01-01',
      periodEnd: '2026-06-01',
    });
    expect(hint.appointment).toContain('선임 참고 대상이 아닙니다');
    expect(hint.technicalGuidance).toContain('기술지도 계약 대상');
  });

  it('uses the 120억 dedicated line for building work and the 150억 line for civil work', () => {
    const building = safetyScaleHint({ amount: 130 * EOK, constructionType: '건축' });
    const civil = safetyScaleHint({ amount: 130 * EOK, constructionType: '토목' });
    expect(building.appointment).toContain('전담');
    expect(building.technicalGuidance).toContain('구간 밖');
    expect(civil.appointment).not.toContain('전담');
    expect(civil.technicalGuidance).toContain('기술지도 계약 대상');
  });

  it('steps the appointment count at 800억 and 1,500억', () => {
    expect(safetyScaleHint({ amount: 900 * EOK, constructionType: '건축' }).appointment).toContain('2명');
    expect(safetyScaleHint({ amount: 2000 * EOK, constructionType: '건축' }).appointment).toContain('3명');
    expect(safetyScaleHint({ amount: 3000 * EOK, constructionType: '건축' }).appointment).toContain('추가 구간');
  });

  it('drops technical guidance when the period is under one month', () => {
    expect(constructionPeriodUnderOneMonth('2026-03-01', '2026-03-20')).toBe(true);
    expect(constructionPeriodUnderOneMonth('2026-03-01', '2026-04-01')).toBe(false);
    const hint = safetyScaleHint({
      amount: 30 * EOK,
      constructionType: '건축',
      periodStart: '2026-03-01',
      periodEnd: '2026-03-20',
    });
    expect(hint.technicalGuidance).toContain('1개월 미만');
  });
});
