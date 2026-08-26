import { describe, expect, it } from 'vitest';
import {
  deriveResidualGrades,
  deriveResidualLikelihood,
  isFlattenedResidualPlaceholder,
} from '@/lib/riskGrade';
import { seedFillDetailFromRow } from '@/lib/riskFillComplete';

describe('deriveResidualGrades', () => {
  it('drops likelihood one step and keeps severity (never flatten 상 to 하/하/하)', () => {
    expect(deriveResidualLikelihood('상')).toBe('중');
    expect(deriveResidualGrades('중', '상')).toEqual({ likelihood: '하', severity: '상', risk: '중' });
    expect(deriveResidualGrades('상', '상')).toEqual({ likelihood: '중', severity: '상', risk: '상' });
    expect(deriveResidualGrades('중', '중')).toEqual({ likelihood: '하', severity: '중', risk: '하' });
    expect(deriveResidualGrades('하', '중')).toEqual({ likelihood: '하', severity: '중', risk: '하' });
  });
});

describe('isFlattenedResidualPlaceholder', () => {
  it('treats insert-default 하/하/하 on a 상 row as placeholder', () => {
    expect(
      isFlattenedResidualPlaceholder({
        likelihood_grade: '중',
        severity_grade: '상',
        risk_grade: '상',
        improved_likelihood_grade: '하',
        improved_severity_grade: '하',
        improved_risk_grade: '하',
      }),
    ).toBe(true);
  });

  it('keeps a judged residual 하/상/중', () => {
    expect(
      isFlattenedResidualPlaceholder({
        likelihood_grade: '중',
        severity_grade: '상',
        risk_grade: '상',
        improved_likelihood_grade: '하',
        improved_severity_grade: '상',
        improved_risk_grade: '중',
      }),
    ).toBe(false);
  });

  it('does not flag real 하 residual when initial is already 하/하', () => {
    expect(
      isFlattenedResidualPlaceholder({
        likelihood_grade: '하',
        severity_grade: '하',
        risk_grade: '하',
        improved_likelihood_grade: '하',
        improved_severity_grade: '하',
        improved_risk_grade: '하',
      }),
    ).toBe(false);
  });
});

describe('seedFillDetailFromRow residual', () => {
  it('rewrites flattened 하/하/하 on 중/상 to 하/상/중', () => {
    const d = seedFillDetailFromRow({
      hazard: '사다리 추락',
      likelihood_grade: '중',
      severity_grade: '상',
      risk_grade: '상',
      improved_likelihood_grade: '하',
      improved_severity_grade: '하',
      improved_risk_grade: '하',
    });
    expect(d.improved_likelihood_grade).toBe('하');
    expect(d.improved_severity_grade).toBe('상');
    expect(d.improved_risk_grade).toBe('중');
  });
});
