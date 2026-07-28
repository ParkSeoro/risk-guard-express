/** Approval stamp with time — e.g. `2026. 7. 28. 15:30` (month/day unpadded). */
export function formatPermitStamp(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
export const PERMIT_STAMP_FORMAT = 'YYYY. M. D. HH:mm';
