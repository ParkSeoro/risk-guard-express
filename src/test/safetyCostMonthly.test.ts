import { describe, expect, it } from 'vitest';
import {
  isPostgresUniqueViolation,
  monthlyReportExistsCopy,
  planCreateMonthlyReport,
  toSafetyCostMonthStart,
} from '@/lib/safetyCostMonthly';

describe('toSafetyCostMonthStart', () => {
  it('normalizes month input to first-of-month', () => {
    expect(toSafetyCostMonthStart('2026-08')).toBe('2026-08-01');
    expect(toSafetyCostMonthStart('2026-08-15')).toBe('2026-08-01');
    expect(toSafetyCostMonthStart('2026-08-01')).toBe('2026-08-01');
  });
});

describe('isPostgresUniqueViolation', () => {
  it('detects unique constraint failures', () => {
    expect(isPostgresUniqueViolation({ code: '23505' })).toBe(true);
    expect(isPostgresUniqueViolation({
      message: 'duplicate key value violates unique constraint "safety_cost_monthly_reports_construction_id_report_month_key"',
    })).toBe(true);
    expect(isPostgresUniqueViolation({ code: '42501', message: 'permission denied' })).toBe(false);
    expect(isPostgresUniqueViolation(null)).toBe(false);
  });
});

describe('planCreateMonthlyReport', () => {
  it('inserts when nothing exists', () => {
    expect(planCreateMonthlyReport([])).toEqual({ action: 'insert' });
  });

  it('opens the live row when the month already exists', () => {
    const plan = planCreateMonthlyReport([
      { id: 'deleted', is_deleted: true, created_at: '2026-08-02', approval_version: 2 },
      { id: 'live-old', is_deleted: false, created_at: '2026-08-01', approval_version: 1 },
      { id: 'live-new', is_deleted: false, created_at: '2026-08-03', approval_version: 1 },
    ]);
    expect(plan).toEqual({
      action: 'open',
      row: expect.objectContaining({ id: 'live-new' }),
    });
  });

  it('restores the newest deleted row when no live month exists', () => {
    const plan = planCreateMonthlyReport([
      { id: 'old', is_deleted: true, created_at: '2026-07-01' },
      { id: 'new', is_deleted: true, created_at: '2026-08-01' },
    ]);
    expect(plan).toEqual({
      action: 'restore',
      row: expect.objectContaining({ id: 'new' }),
    });
  });
});

describe('monthlyReportExistsCopy', () => {
  it('does not expose postgres constraint names', () => {
    expect(monthlyReportExistsCopy('create').title).toContain('이미 있습니다');
    expect(monthlyReportExistsCopy('create').description).not.toMatch(/unique constraint/i);
  });
});
