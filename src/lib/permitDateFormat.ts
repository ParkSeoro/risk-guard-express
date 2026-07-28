/** Permit / print stamp: always include date + time. */
export function formatPermitStamp(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}. ${pad(d.getMonth() + 1)}. ${pad(d.getDate())}. ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Default overlay slot format matching print stamps */
export const PERMIT_STAMP_FORMAT = 'YYYY. MM. DD. HH:mm';
