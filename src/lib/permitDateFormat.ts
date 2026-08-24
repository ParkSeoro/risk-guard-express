export type PermitStampParts = {
  date: string;
  time: string;
};

/**
 * Split approval datetime for the 승인일 cell (date + time stacked).
 * Seconds stay on the time line so two stamps in the same minute do not collapse.
 * Does not change table column widths or row-height tokens.
 */
export function formatPermitStampParts(iso?: string | null): PermitStampParts | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}

/**
 * Approval stamp with time including seconds —
 * e.g. `2026. 7. 28. 15:30:07` (month/day unpadded).
 * Seconds are required so distinct approver clocks do not collapse to the same minute.
 */
export function formatPermitStamp(iso?: string | null): string {
  const parts = formatPermitStampParts(iso);
  if (!parts) return '';
  return `${parts.date} ${parts.time}`;
}

/**
 * Form/print display for work_start / work_end.
 * Prefer datetime-local calendar intent (`YYYY-MM-DDTHH:mm` → `YYYY-MM-DD HH:mm`)
 * so ISO `T` does not leak onto the printed sheet.
 */
export function formatPermitDateTime(value?: string | null): string {
  if (!value || typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const local = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?/);
  if (local) return `${local[1]} ${local[2]}`;
  const stamped = formatPermitStamp(trimmed);
  return stamped || trimmed;
}

export function formatPermitDateTimeRange(
  start?: string | null,
  end?: string | null,
): string {
  const a = formatPermitDateTime(start);
  const b = formatPermitDateTime(end);
  if (a && b) return `${a} ~ ${b}`;
  return a || b || '';
}

/**
 * "전일 검토, 당일 작업 전 승인" — review date = approval datetime minus 1 calendar day.
 * Format: `YYYY. M. D.` (no time), e.g. `2026. 7. 27.`
 */
export function formatPermitReviewDate(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

/** Default overlay slot format matching print stamps */
export const PERMIT_STAMP_FORMAT = 'YYYY. M. D. HH:mm:ss';
