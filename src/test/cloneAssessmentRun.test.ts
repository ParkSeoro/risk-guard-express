import { describe, expect, it } from 'vitest';
import {
  copyParticipantsForClone,
  copyRiskItemsForClone,
  type CloneAssessmentRunSource,
} from '@/lib/cloneAssessmentRun';

describe('cloneAssessmentRun helpers', () => {
  it('keeps company scope on the source type', () => {
    const source: CloneAssessmentRunSource = {
      id: 'run-1',
      project_id: 'p1',
      type: '정기',
      period_label: '2026-08',
      target_company_ids: ['co-a'],
      opinion_required: true,
      health_required: false,
      author_user_id: 'author-1',
    };
    expect(source.target_company_ids).toEqual(['co-a']);
    expect(source.health_required).toBe(false);
    expect(source.author_user_id).toBe('author-1');
  });

  it('copies live risk items, skips excluded, resets status, omits is_locked', () => {
    const copies = copyRiskItemsForClone(
      [
        {
          id: 'old',
          created_at: 't',
          updated_at: 't',
          run_id: 'run-old',
          project_id: 'p1',
          process: '용접',
          hazard: '화재',
          is_deleted: false,
          is_excluded: false,
          status: '완료',
          sort_order: 2,
        },
        {
          id: 'excluded',
          run_id: 'run-old',
          project_id: 'p1',
          process: '제외공정',
          hazard: 'x',
          is_deleted: false,
          is_excluded: true,
        },
        {
          id: 'gone',
          run_id: 'run-old',
          project_id: 'p1',
          process: '삭제',
          hazard: 'x',
          is_deleted: true,
          is_excluded: false,
        },
      ],
      'run-new',
      'u1',
    );
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({
      run_id: 'run-new',
      project_id: 'p1',
      process: '용접',
      hazard: '화재',
      status: '미착수',
      created_by: 'u1',
      is_deleted: false,
      is_excluded: false,
      sort_order: 2,
    });
    expect(copies[0]).not.toHaveProperty('id');
    expect(copies[0]).not.toHaveProperty('is_locked');
    expect(copies[0]).not.toHaveProperty('batch_id');
  });

  it('does not send generated risk scores', () => {
    const copies = copyRiskItemsForClone(
      [
        {
          project_id: 'p1',
          process: '용접',
          frequency: 3,
          severity: 2,
          risk: 6,
          improved_frequency: 1,
          improved_severity: 2,
          improved_risk: 2,
          is_deleted: false,
          is_excluded: false,
        },
      ],
      'run-new',
      'u1',
    );
    expect(copies[0].frequency).toBe(3);
    expect(copies[0].severity).toBe(2);
    expect(copies[0].improved_frequency).toBe(1);
    expect(copies[0].improved_severity).toBe(2);
    expect(copies[0]).not.toHaveProperty('risk');
    expect(copies[0]).not.toHaveProperty('improved_risk');
  });

  it('copies participants without signatures', () => {
    const copies = copyParticipantsForClone(
      [
        {
          id: 'p1',
          created_at: 't',
          signed_at: '2026-01-01',
          run_id: 'run-old',
          role: '작성자',
          user_name: '현호',
          company: 'A사',
        },
      ],
      'run-new',
    );
    expect(copies).toEqual([
      {
        run_id: 'run-new',
        role: '작성자',
        user_name: '현호',
        company: 'A사',
        signed_at: null,
      },
    ]);
  });
});
