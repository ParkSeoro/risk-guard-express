import { describe, expect, it } from 'vitest';
import {
  copyParticipantsForClone,
  copyRiskItemsForClone,
  type CloneAssessmentRunSource,
} from '@/lib/cloneAssessmentRun';

describe('cloneAssessmentRun helpers', () => {
  it('keeps company scope and dates on the source type', () => {
    const source: CloneAssessmentRunSource = {
      id: 'run-1',
      project_id: 'p1',
      type: '정기',
      period_label: '2026-08',
      target_company_ids: ['co-a'],
      start_date: '2026-08-01',
      end_date: '2026-08-31',
      opinion_required: true,
      health_required: false,
    };
    expect(source.target_company_ids).toEqual(['co-a']);
    expect(source.health_required).toBe(false);
  });

  it('copies live risk items without ids/locks and resets status', () => {
    const copies = copyRiskItemsForClone([{
      id: 'old',
      created_at: 't',
      updated_at: 't',
      submitted_at: 't',
      submitted_by: 'u0',
      is_locked: true,
      batch_id: 'b',
      version_number: 3,
      run_id: 'run-old',
      process: '용접',
      hazard: '화재',
      is_deleted: false,
    }], 'run-new', 'u1');
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({
      run_id: 'run-new',
      process: '용접',
      hazard: '화재',
      status: '미착수',
      is_locked: false,
      created_by: 'u1',
      is_deleted: false,
    });
    expect(copies[0]).not.toHaveProperty('id');
    expect(copies[0]).not.toHaveProperty('submitted_at');
  });

  it('copies participants unsigned onto the new run', () => {
    const copies = copyParticipantsForClone([{
      id: 'p1',
      created_at: 't',
      signed_at: '2026-01-01',
      run_id: 'run-old',
      role: '작성자',
      user_name: '현호',
    }], 'run-new');
    expect(copies).toEqual([{
      run_id: 'run-new',
      role: '작성자',
      user_name: '현호',
      signed_at: null,
    }]);
  });
});
