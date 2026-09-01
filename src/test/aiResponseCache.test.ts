import { describe, expect, it } from 'vitest';
import { mapAssessmentAccidentRow } from '../../supabase/functions/_shared/aiResponseCache';

describe('mapAssessmentAccidentRow', () => {
  it('uses accident_type because assessment_accidents has no title column', () => {
    const mapped = mapAssessmentAccidentRow({
      accident_type: '폭염 온열질환 사망',
      occurrence_date: '2024-08-01',
      location: '현장',
      accident_summary: '옥외 작업 중 온열질환',
      cause: '휴식 미흡',
      result: '사망',
      prevention: '휴식·수분 공급',
    });
    expect(mapped.title).toBe('폭염 온열질환 사망');
    expect(mapped.source).toBe('library');
  });

  it('falls back to description when accident_summary is empty', () => {
    const mapped = mapAssessmentAccidentRow({
      accident_type: '낙하',
      description: '자재 낙하',
    });
    expect(mapped.accident_summary).toBe('자재 낙하');
  });
});
