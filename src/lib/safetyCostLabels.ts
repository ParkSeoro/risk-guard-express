/** Korean localization and OCR year-anomaly helpers for Safety Cost screens (#10). */

const REPORT_STATUS_LABELS: Record<string, string> = {
  draft: '작성중',
  submitted: '상신됨',
  in_approval: '결재중',
  approved: '승인완료',
  rejected: '반려',
  legacy_import: '이관완료',
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: '치명',
  high: '높음',
  medium: '보통',
  low: '낮음',
};

const VIOLATION_CODE_LABELS: Record<string, string> = {
  EVIDENCE_MISSING: '증빙 파일 누락',
  TAX_INVOICE_MISSING: '세금계산서 누락',
  RATIO_UNDER: '법정 비율 미달',
  RATIO_OVER: '법정 비율 초과',
  AMOUNT_MISMATCH: '금액 불일치',
  INELIGIBLE_ITEM: '사용 불가 항목',
  DATE_OUT_OF_RANGE: '사용일 범위 이탈',
  PPE_LEDGER_MISSING: '보호구 지급대장 누락',
};

export function safetyCostReportStatusLabel(status?: string | null): string {
  const raw = String(status || '').trim();
  if (!raw) return '작성중';
  return REPORT_STATUS_LABELS[raw.toLowerCase()] || raw;
}

export function safetyCostSeverityLabel(severity?: string | null): string {
  const raw = String(severity || '').trim();
  if (!raw) return '보통';
  return SEVERITY_LABELS[raw.toLowerCase()] || raw;
}

export function safetyCostViolationLabel(code?: string | null): string {
  const raw = String(code || '').trim();
  if (!raw) return '';
  return VIOLATION_CODE_LABELS[raw.toUpperCase()] || raw;
}

/**
 * Flags OCR-misparsed receipt years (e.g. `2022-11-03` inside a `2026-11` monthly report).
 * Returns true when both dates have valid 4-digit years differing by at least 2 years.
 */
export function isSafetyCostYearAnomaly(
  itemDate?: string | null,
  reportMonth?: string | null,
): boolean {
  const itemMatch = String(itemDate || '').trim().match(/^(\d{4})-/);
  const reportMatch = String(reportMonth || '').trim().match(/^(\d{4})-/);
  if (!itemMatch || !reportMatch) return false;
  const itemYear = Number(itemMatch[1]);
  const reportYear = Number(reportMatch[1]);
  if (!Number.isFinite(itemYear) || !Number.isFinite(reportYear)) return false;
  return Math.abs(itemYear - reportYear) >= 2;
}
