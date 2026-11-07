import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  formatWeekChoice,
  seoulISODate,
  shouldSkipWeeklyModel,
  weekEndSunday,
  weekIndexInMonth,
  weekStartMonday,
  weeklyReportText,
  weeksInMonth,
} from '@/lib/weeklySafetyReport';

const sql = readFileSync('supabase/migrations/20261107120000_weekly_safety_report.sql', 'utf8');
const mergeSql = readFileSync('supabase/migrations/20261107143000_weekly_report_merge_places.sql', 'utf8');
const writer = readFileSync('supabase/functions/write-weekly-safety-report/index.ts', 'utf8');

describe('weekly safety report calendar', () => {
  it('treats a week as Monday through Sunday and numbers it from the Monday', () => {
    expect(weekStartMonday('2026-11-01')).toBe('2026-10-26');
    expect(weekEndSunday('2026-10-26')).toBe('2026-11-01');
    expect(weekIndexInMonth('2026-11-02')).toEqual({ year: 2026, month: 11, index: 1 });
    expect(weekIndexInMonth('2026-11-30')).toEqual({ year: 2026, month: 11, index: 5 });
    const november = weeksInMonth(2026, 11);
    expect(november).toHaveLength(5);
    expect(november[0]).toEqual({ index: 1, start: '2026-11-02', end: '2026-11-08' });
    expect(formatWeekChoice(november[0])).toBe('1주차 (11월 2일 – 11월 8일)');
    expect(seoulISODate(new Date('2026-11-07T15:30:00Z'))).toBe('2026-11-08');
  });

  it('prints saved results and leaves blank plans blank', () => {
    const text = weeklyReportText('[현장 현장 주간 안전보고]\n\n(청원산기)\n■ 전기', {
      plan: { meeting: 1, inspection: null },
      actual: { inspection: 2, education: 4, work_stop: 0 },
    });
    expect(text).toContain('(청원산기)');
    expect(text).toContain('안전회의: 계획 1 / 실적 —');
    expect(text).toContain('안전점검: 계획 — / 실적 2');
    expect(text).toContain('안전교육: 계획 — / 실적 4');
    expect(text).toContain('경고·작업중지: 계획 — / 실적 0');
    expect(text).toContain('출입정지·퇴출: —명');
    expect(text).toContain('재해: —건');
    const counted = weeklyReportText('본문', { inspection: 9, education: 9 });
    expect(counted).toContain('안전점검: 계획 — / 실적 —');
    expect(counted).not.toContain('실적 9');
  });

  it('skips the model only when the stored report is ready and the work is unchanged', () => {
    expect(shouldSkipWeeklyModel('ready', true)).toBe(true);
    expect(shouldSkipWeeklyModel('ready', false)).toBe(false);
    expect(shouldSkipWeeklyModel('digest', true)).toBe(false);
    expect(shouldSkipWeeklyModel('failed', true)).toBe(false);
  });

  it('stores a Monday-Sunday report on Sunday night without scanning on each visit', () => {
    expect(sql).toContain('v_week_end date := v_week_start + 6');
    expect(sql).toContain("'0 12 * * 0'");
    expect(sql).toContain('source_hash');
    expect(sql).toContain("status = 'ready'");
    expect(sql).not.toContain('v_week_start + 4');
    expect(sql).not.toContain('bullet_count > 8');
    expect(writer).toContain('작업 내용이 그대로입니다');
    expect(writer).toContain('위험이 크지 않은 작업은 작업 내용만 남기세요');
    expect(writer).toContain('요인에 의한 위험');
    expect(writer).toContain('위험 줄에 요인만 있습니다');
    expect(writer).toContain('stripRepeatedHeadings');
    expect(writer).toContain('gemini-2.5-flash');
    expect(writer).not.toContain('최대 6');
    expect(mergeSql).toContain('weekly_condense_bullets');
    expect(mergeSql).toContain('PERFORM public.weekly_prepare_report_items()');
    expect(mergeSql).toContain('stats = public.owner_weekly_work_reports.stats');
  });
});
