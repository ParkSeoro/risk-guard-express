import { describe, expect, it } from 'vitest';
import {
  ASSESSMENT_RUN_TYPES,
  buildAssessmentRunCreatePayload,
  emptyAssessmentRunCreateForm,
  formatAssessmentRunTypeTag,
  periodLabelPlaceholder,
  resolveAssessmentRunType,
} from '@/lib/assessmentRunType';

describe('assessmentRunType', () => {
  it('keeps 수시 and 상시 instead of falling back to 정기', () => {
    expect(resolveAssessmentRunType('수시')).toBe('수시');
    expect(resolveAssessmentRunType('상시')).toBe('상시');
    expect(resolveAssessmentRunType('최초')).toBe('최초');
    expect(resolveAssessmentRunType('정기')).toBe('정기');
  });

  it('falls back to 정기 only for unknown or list-filter all', () => {
    expect(resolveAssessmentRunType('all')).toBe('정기');
    expect(resolveAssessmentRunType('')).toBe('정기');
    expect(resolveAssessmentRunType(null)).toBe('정기');
    expect(resolveAssessmentRunType('weekly')).toBe('정기');
  });

  it('seeds create form from the list type filter', () => {
    expect(emptyAssessmentRunCreateForm('수시').type).toBe('수시');
    expect(emptyAssessmentRunCreateForm('상시').type).toBe('상시');
    expect(emptyAssessmentRunCreateForm('all').type).toBe('정기');
  });

  it('writes the selected type onto the insert payload', () => {
    const form = emptyAssessmentRunCreateForm('수시', 'sup-1');
    form.period_label = '  수시 · 공정변경  ';
    form.start_date = '2026-08-24';
    form.end_date = '2026-08-30';
    form.target_company_ids = ['co-1'];
    const payload = buildAssessmentRunCreatePayload({
      projectId: 'proj-1',
      userId: 'sm-1',
      form,
      contractorNames: ['정원'],
    });
    expect(payload.type).toBe('수시');
    expect(payload.period_label).toBe('수시 · 공정변경');
    expect(payload.status).toBe('작성중');
    expect(payload.created_by).toBe('sm-1');
    expect(payload.author_user_id).toBe('sup-1');
    expect(payload.target_company_ids).toEqual(['co-1']);
    expect(payload.target_contractors).toEqual(['정원']);
  });

  it('does not relabel 수시/상시 period placeholders as weekly 정기', () => {
    expect(periodLabelPlaceholder('수시')).toContain('수시');
    expect(periodLabelPlaceholder('상시')).toContain('상시');
    expect(periodLabelPlaceholder('정기')).toContain('주차');
    expect(formatAssessmentRunTypeTag('수시')).toBe('수시평가');
    expect(ASSESSMENT_RUN_TYPES).toContain('수시');
  });
});
