/**
 * 실측 출퇴근 시간·공수 계산 (급여 기준 아님).
 * 서울 달력일·주(월~일)·야간(22:00–06:00)을 사용한다.
 */
import {
  HEALTH_PLEDGE,
  NO_ACCIDENT_PLEDGE,
  WORK_ACK_PLEDGE,
} from "@/lib/legal/dailyPledges";

export const SEOUL_TZ = "Asia/Seoul";
export const MINUTES_PER_MAN_DAY = 480;
export const MIN_MAN_DAY = 0.25;
export const WEEK52_WARN_MINUTES = 52 * 60;
export const WEEK52_CAUTION_MINUTES = 45 * 60;
export const STREAK_WARN_DAYS = 7;

export type Week52Status = "ok" | "caution" | "warn";
export type HoursRollupGroup = "worker" | "job_type" | "company" | "project";

export type WorkHourRow = {
  entryLogId: string;
  workerId: string;
  workerName: string;
  workDate: string;
  entryAt: string;
  exitAt: string | null;
  minutes: number | null;
  manDays: number | null;
  nightMinutes: number;
  incomplete: boolean;
  sunday: boolean;
  jobType: string;
  companyId: string | null;
  companyName: string;
};

export type HoursRollup = {
  key: string;
  label: string;
  workerCount: number;
  dayCount: number;
  minutes: number;
  manDays: number;
  nightMinutes: number;
  incompleteCount: number;
  sundayMinutes: number;
  week52WarnCount: number;
  week52CautionCount: number;
  maxStreak: number;
};

export function seoulDateString(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: SEOUL_TZ });
}

export function addSeoulDays(day: string, n: number): string {
  const t = new Date(`${day}T12:00:00+09:00`).getTime() + n * 86_400_000;
  return seoulDateString(new Date(t));
}

/** Monday (YYYY-MM-DD, Seoul) of the week containing `day`. */
export function seoulWeekStart(day: string): string {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : seoulDateString(day);
  const noon = new Date(`${d}T12:00:00+09:00`);
  const dow = noon.getUTCDay(); // Sun=0 … Sat=6 at +09:00 noon
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return addSeoulDays(d, mondayOffset);
}

export function seoulMonthKey(day: string): string {
  return String(day || "").slice(0, 7);
}

export function isSeoulSunday(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return new Date(`${day}T12:00:00+09:00`).getUTCDay() === 0;
}

export function workMinutes(
  entryAt: string | null | undefined,
  exitAt: string | null | undefined,
): number | null {
  if (!entryAt || !exitAt) return null;
  const a = new Date(entryAt).getTime();
  const b = new Date(exitAt).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b <= a) return 0;
  return Math.floor((b - a) / 60_000);
}

/** 출·퇴가 모두 있으면 최소 0.25 공수. 미퇴장은 null. */
export function manDaysFromSpan(
  entryAt: string | null | undefined,
  exitAt: string | null | undefined,
): number | null {
  if (!entryAt || !exitAt) return null;
  const minutes = workMinutes(entryAt, exitAt) ?? 0;
  const raw = Math.round((minutes / MINUTES_PER_MAN_DAY) * 100) / 100;
  return Math.max(raw, MIN_MAN_DAY);
}

export function formatWorkHours(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "—";
  const h = Math.floor(minutes / 60);
  const m = Math.abs(Math.round(minutes % 60));
  return `${h}:${String(m).padStart(2, "0")}`;
}

export function week52Status(weeklyMinutes: number): Week52Status {
  if (weeklyMinutes >= WEEK52_WARN_MINUTES) return "warn";
  if (weeklyMinutes >= WEEK52_CAUTION_MINUTES) return "caution";
  return "ok";
}

function overlapMs(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

/** 서울 22:00–06:00 겹침 분. 미퇴장은 0. */
export function nightMinutes(
  entryAt: string | null | undefined,
  exitAt: string | null | undefined,
): number {
  if (!entryAt || !exitAt) return 0;
  const start = new Date(entryAt).getTime();
  const end = new Date(exitAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;

  let total = 0;
  let day = seoulDateString(new Date(start));
  const lastDay = seoulDateString(new Date(end));
  let guard = 0;
  while (day && day <= lastDay && guard < 40) {
    const dayStart = new Date(`${day}T00:00:00+09:00`).getTime();
    const six = new Date(`${day}T06:00:00+09:00`).getTime();
    const twentyTwo = new Date(`${day}T22:00:00+09:00`).getTime();
    const nextMidnight = new Date(`${addSeoulDays(day, 1)}T00:00:00+09:00`).getTime();
    total += overlapMs(start, end, dayStart, six);
    total += overlapMs(start, end, twentyTwo, nextMidnight);
    day = addSeoulDays(day, 1);
    guard += 1;
  }
  return Math.floor(total / 60_000);
}

export function buildWorkHourRow(input: {
  entryLogId: string;
  workerId: string;
  workerName?: string | null;
  entryAt: string;
  exitAt?: string | null;
  jobType?: string | null;
  companyId?: string | null;
  companyName?: string | null;
}): WorkHourRow {
  const workDate = seoulDateString(input.entryAt);
  const minutes = workMinutes(input.entryAt, input.exitAt);
  return {
    entryLogId: input.entryLogId,
    workerId: input.workerId,
    workerName: input.workerName || "",
    workDate,
    entryAt: input.entryAt,
    exitAt: input.exitAt || null,
    minutes,
    manDays: manDaysFromSpan(input.entryAt, input.exitAt),
    nightMinutes: nightMinutes(input.entryAt, input.exitAt),
    incomplete: !input.exitAt,
    sunday: isSeoulSunday(workDate),
    jobType: (input.jobType || "").trim() || "미분류",
    companyId: input.companyId || null,
    companyName: (input.companyName || "").trim() || "미분류",
  };
}

export function consecutiveAttendanceDays(dates: string[]): number {
  const uniq = [...new Set(dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  if (uniq.length === 0) return 0;
  let max = 1;
  let run = 1;
  for (let i = 1; i < uniq.length; i++) {
    if (addSeoulDays(uniq[i - 1], 1) === uniq[i]) {
      run += 1;
      if (run > max) max = run;
    } else {
      run = 1;
    }
  }
  return max;
}

/** workerId → weekStart → complete minutes */
export function weeklyMinutesByWorker(rows: WorkHourRow[]): Map<string, Map<string, number>> {
  const out = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.minutes == null) continue;
    let weeks = out.get(r.workerId);
    if (!weeks) {
      weeks = new Map();
      out.set(r.workerId, weeks);
    }
    const wk = seoulWeekStart(r.workDate);
    weeks.set(wk, (weeks.get(wk) || 0) + r.minutes);
  }
  return out;
}

function week52CountsForWorkers(
  rows: WorkHourRow[],
  workerIds: Set<string>,
): { warn: number; caution: number } {
  const weeks = weeklyMinutesByWorker(rows.filter((r) => workerIds.has(r.workerId)));
  let warn = 0;
  let caution = 0;
  const seen = new Set<string>();
  for (const [workerId, map] of weeks) {
    for (const [, mins] of map) {
      const st = week52Status(mins);
      const key = `${workerId}:${st}`;
      if (st === "warn" && !seen.has(key)) {
        seen.add(key);
        warn += 1;
      } else if (st === "caution" && !seen.has(`${workerId}:warn`) && !seen.has(key)) {
        seen.add(key);
        caution += 1;
      }
    }
  }
  return { warn, caution };
}

export function rollupWorkHours(rows: WorkHourRow[], group: HoursRollupGroup): HoursRollup[] {
  const buckets = new Map<string, WorkHourRow[]>();
  for (const r of rows) {
    let key = "project";
    if (group === "worker") key = r.workerId;
    else if (group === "job_type") key = r.jobType;
    else if (group === "company") key = r.companyId || r.companyName;
    const list = buckets.get(key) || [];
    list.push(r);
    buckets.set(key, list);
  }

  const result: HoursRollup[] = [];
  for (const [key, list] of buckets) {
    const workerIds = new Set(list.map((r) => r.workerId));
    const dates = [...new Set(list.map((r) => r.workDate))];
    const complete = list.filter((r) => r.minutes != null);
    const minutes = complete.reduce((s, r) => s + (r.minutes || 0), 0);
    const manDays = complete.reduce((s, r) => s + (r.manDays || 0), 0);
    const night = complete.reduce((s, r) => s + r.nightMinutes, 0);
    const sundayMinutes = complete
      .filter((r) => r.sunday)
      .reduce((s, r) => s + (r.minutes || 0), 0);
    const flags = week52CountsForWorkers(list, workerIds);
    const maxStreak = Math.max(
      0,
      ...[...workerIds].map((id) =>
        consecutiveAttendanceDays(list.filter((r) => r.workerId === id).map((r) => r.workDate)),
      ),
    );
    const label =
      group === "worker"
        ? list[0]?.workerName || key
        : group === "project"
          ? "전체"
          : key;
    result.push({
      key,
      label,
      workerCount: workerIds.size,
      dayCount: dates.length,
      minutes,
      manDays: Math.round(manDays * 100) / 100,
      nightMinutes: night,
      incompleteCount: list.filter((r) => r.incomplete).length,
      sundayMinutes,
      week52WarnCount: flags.warn,
      week52CautionCount: flags.caution,
      maxStreak,
    });
  }
  return result.sort((a, b) => b.minutes - a.minutes || a.label.localeCompare(b.label, "ko"));
}

export function summarizeHours(rows: WorkHourRow[]) {
  const roll = rollupWorkHours(rows, "project")[0];
  const weeks = weeklyMinutesByWorker(rows);
  let warnPeople = 0;
  let cautionPeople = 0;
  for (const [, map] of weeks) {
    let person: Week52Status = "ok";
    for (const mins of map.values()) {
      const st = week52Status(mins);
      if (st === "warn") person = "warn";
      else if (st === "caution" && person === "ok") person = "caution";
    }
    if (person === "warn") warnPeople += 1;
    else if (person === "caution") cautionPeople += 1;
  }
  return {
    workerCount: roll?.workerCount || 0,
    minutes: roll?.minutes || 0,
    manDays: roll?.manDays || 0,
    incompleteCount: roll?.incompleteCount || 0,
    week52WarnCount: warnPeople,
    week52CautionCount: cautionPeople,
    nightMinutes: roll?.nightMinutes || 0,
  };
}

export function hashPledgeText(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h) ^ text.charCodeAt(i);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export const PLEDGE_TEXTS = {
  work: WORK_ACK_PLEDGE,
  no_accident: NO_ACCIDENT_PLEDGE,
  health: HEALTH_PLEDGE,
} as const;

export const PLEDGE_HASHES: Record<string, string> = {
  work: hashPledgeText(WORK_ACK_PLEDGE),
  no_accident: hashPledgeText(NO_ACCIDENT_PLEDGE),
  health: hashPledgeText(HEALTH_PLEDGE),
};

const HASH_TO_TEXT = new Map(
  Object.entries(PLEDGE_TEXTS).map(([k, text]) => [PLEDGE_HASHES[k], text]),
);

export function pledgeTextByHash(hash: string | null | undefined): string | null {
  if (!hash) return null;
  return HASH_TO_TEXT.get(hash) || null;
}

export function unlabeledJobType(value: string | null | undefined): string {
  return (value || "").trim() || "미분류";
}
