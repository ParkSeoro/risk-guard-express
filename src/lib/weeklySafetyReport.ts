export type WeeklyPlanNumbers = {
  meeting?: number | null;
  inspection?: number | null;
  education?: number | null;
  work_stop?: number | null;
};

export type WeeklyReportStats = {
  inspection?: number | null;
  education?: number | null;
  work_stop?: number | null;
  suspension?: number | null;
  incident?: number | null;
  plan?: WeeklyPlanNumbers | null;
  meeting_actual?: number | null;
};

export type WeekChoice = {
  index: number;
  start: string;
  end: string;
};

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function seoulISODate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function utcDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1));
}

function isoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Monday of the week that contains this calendar day. */
export function weekStartMonday(iso: string): string {
  const date = utcDate(iso);
  const weekday = date.getUTCDay();
  const shift = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + shift);
  return isoDate(date);
}

export function weekEndSunday(weekStart: string): string {
  const date = utcDate(weekStart);
  date.setUTCDate(date.getUTCDate() + 6);
  return isoDate(date);
}

/** Weeks whose Monday falls in this month. The first Monday is week 1. */
export function weeksInMonth(year: number, month: number): WeekChoice[] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (8 - first.getUTCDay()) % 7;
  first.setUTCDate(1 + offset);
  const weeks: WeekChoice[] = [];
  let index = 1;
  while (first.getUTCMonth() === month - 1) {
    const start = isoDate(first);
    weeks.push({ index, start, end: weekEndSunday(start) });
    first.setUTCDate(first.getUTCDate() + 7);
    index += 1;
  }
  return weeks;
}

export function weekIndexInMonth(weekStart: string): { year: number; month: number; index: number } {
  const date = utcDate(weekStartMonday(weekStart));
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const found = weeksInMonth(year, month).find((week) => week.start === isoDate(date));
  return { year, month, index: found?.index || 1 };
}

export function formatKoreanDay(iso: string): string {
  const [, month, day] = iso.split('-');
  return `${Number(month)}월 ${Number(day)}일`;
}

export function formatWeekChoice(week: WeekChoice): string {
  return `${week.index}주차 (${formatKoreanDay(week.start)} – ${formatKoreanDay(week.end)})`;
}

function countText(value: number | null | undefined): string {
  return value == null || Number.isNaN(Number(value)) ? '—' : String(value);
}

export function weeklyStatsFooter(stats: WeeklyReportStats | null | undefined): string {
  const row = stats || {};
  const plan = row.plan || {};
  return [
    '주간 안전관리 실적',
    `- 안전회의: 계획 ${countText(plan.meeting)} / 실적 ${countText(row.meeting_actual)}`,
    `- 안전점검: 계획 ${countText(plan.inspection)} / 실적 ${row.inspection ?? 0}`,
    `- 안전교육: 계획 ${countText(plan.education)} / 실적 ${row.education ?? 0}`,
    `- 경고·작업중지: 계획 ${countText(plan.work_stop)} / 실적 ${row.work_stop ?? 0}`,
    `- 출입정지·퇴출: ${row.suspension ?? 0}명`,
    `- 재해: ${row.incident ?? 0}건`,
  ].join('\n');
}

export function weeklyReportText(body: string, stats: WeeklyReportStats | null | undefined): string {
  const narrative = String(body || '').trim();
  const footer = weeklyStatsFooter(stats);
  return narrative ? `${narrative}\n\n${footer}` : footer;
}

/** A stored ready report is reused when the permit bundle did not change. */
export function shouldSkipWeeklyModel(status: string | null | undefined, sameBundle: boolean): boolean {
  return status === 'ready' && sameBundle;
}
