/** 안관비 OCR 판독 상태 SSOT — 값이 비면 저장하지 않는다. */

export const OCR_LOW_CONFIDENCE = 0.7;

export type SafetyCostOcrStatus =
  | 'ocr_raw'
  | 'ocr_low'
  | 'ai_corrected'
  | 'rule_fallback'
  | 'user_edited'
  | 'no_vision';

export const OCR_STATUS_LABEL: Record<SafetyCostOcrStatus, string> = {
  ocr_raw: 'OCR 원문입니다. 숫자·상호를 원본과 대조하세요.',
  ocr_low: 'OCR 신뢰도가 낮습니다. 원본 증빙을 확인하세요.',
  ai_corrected: 'AI가 OCR 결과를 보정했습니다. 원본과 다른 칸을 확인하세요.',
  rule_fallback: '규칙 기반 예비 추출입니다. 거래날짜·공급자·세액을 확인하세요.',
  user_edited: '사용자가 OCR 결과를 직접 수정했습니다.',
  no_vision: '이미지 판독을 건너뛰었습니다. 엑셀이 아니면 항목이 비었을 수 있습니다.',
};

export const OCR_STATUS_BADGE: Record<SafetyCostOcrStatus, string> = {
  ocr_raw: 'OCR 원문',
  ocr_low: 'OCR 낮음',
  ai_corrected: 'AI 보정',
  rule_fallback: '예비 추출',
  user_edited: '사용자 수정',
  no_vision: '이미지 미판독',
};

export function isSafetyCostOcrStatus(value: unknown): value is SafetyCostOcrStatus {
  return typeof value === 'string' && value in OCR_STATUS_LABEL;
}

export function ocrStatusLabel(status?: string | null) {
  if (isSafetyCostOcrStatus(status)) return OCR_STATUS_LABEL[status];
  return '';
}

export function ocrStatusBadge(status?: string | null) {
  if (isSafetyCostOcrStatus(status)) return OCR_STATUS_BADGE[status];
  return '';
}

export function estimateOcrConfidence(text: string, modelConfidence?: number | null) {
  const raw = String(text || '');
  const hangul = (raw.match(/[\uAC00-\uD7A3]/g) || []).length;
  const digits = (raw.match(/\d/g) || []).length;
  let c = typeof modelConfidence === 'number' && Number.isFinite(modelConfidence)
    ? Math.min(1, Math.max(0, modelConfidence))
    : 0.75;
  if (raw.trim().length < 20) c = Math.min(c, 0.35);
  if (hangul < 8 && raw.length > 40) c = Math.min(c, 0.45);
  if (digits < 2 && raw.length > 30) c = Math.min(c, 0.5);
  return Math.round(c * 100) / 100;
}

export function ocrStatusBadgeVariant(
  status?: string | null,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (status === 'ocr_low' || status === 'no_vision') return 'destructive';
  if (status === 'ai_corrected') return 'outline';
  if (status === 'user_edited') return 'default';
  return 'secondary';
}

export function resolveOcrStatus(opts: {
  existing?: string | null;
  engine?: string | null;
  confidence?: number | null;
  fieldsCorrected?: boolean;
  userEdited?: boolean;
  noVision?: boolean;
}): SafetyCostOcrStatus {
  if (opts.userEdited || opts.existing === 'user_edited') return 'user_edited';
  if (opts.noVision || opts.existing === 'no_vision') return 'no_vision';
  if (opts.engine === 'rule' || opts.engine === 'fallback' || opts.existing === 'rule_fallback') {
    return 'rule_fallback';
  }
  const conf = opts.confidence;
  if ((conf != null && conf < OCR_LOW_CONFIDENCE) || opts.existing === 'ocr_low') return 'ocr_low';
  if (opts.fieldsCorrected || opts.existing === 'ai_corrected') return 'ai_corrected';
  if (isSafetyCostOcrStatus(opts.existing)) return opts.existing;
  return 'ocr_raw';
}

export function stampOcrOnItem<T extends Record<string, unknown>>(
  item: T,
  ctx: {
    engine?: string | null;
    confidence?: number | null;
    rawText?: string | null;
    fieldsCorrected?: boolean;
    userEdited?: boolean;
    noVision?: boolean;
  } = {},
): T & { ocr_status: SafetyCostOcrStatus; ocr_confidence: number | null; ocr_raw_text: string } {
  const conf = ctx.confidence != null
    ? Number(ctx.confidence)
    : (item.ocr_confidence != null ? Number(item.ocr_confidence) : null);
  const status = resolveOcrStatus({
    existing: typeof item.ocr_status === 'string' ? item.ocr_status : null,
    engine: ctx.engine,
    confidence: Number.isFinite(conf as number) ? conf : null,
    fieldsCorrected: ctx.fieldsCorrected || item['fields_corrected'] === true,
    userEdited: ctx.userEdited,
    noVision: ctx.noVision,
  });
  const raw = String(ctx.rawText ?? item.ocr_raw_text ?? '').slice(0, 2000);
  return {
    ...item,
    ocr_status: status,
    ocr_confidence: Number.isFinite(conf as number) ? conf : null,
    ocr_raw_text: raw,
  };
}

export function summarizeOcrItems(
  items: Array<{ ocr_status?: string | null; ocr_raw_text?: string | null }>,
) {
  const list = items || [];
  const lowCount = list.filter((it) => it.ocr_status === 'ocr_low' || it.ocr_status === 'no_vision').length;
  const correctedCount = list.filter((it) => it.ocr_status === 'ai_corrected').length;
  const fallbackCount = list.filter((it) => it.ocr_status === 'rule_fallback').length;
  const rawChars = list.reduce((s, it) => s + String(it.ocr_raw_text || '').length, 0);
  return { count: list.length, lowCount, correctedCount, fallbackCount, rawChars };
}

/** 상신 게이트: 저신뢰도·미판독인데 검토 사유가 없는 행 */
export function ocrReviewGaps(
  items: Array<{
    ocr_status?: string | null;
    classification_status?: string | null;
    ai_reason?: string | null;
    is_deleted?: boolean | null;
  }>,
) {
  return (items || []).filter((it) => {
    if (it.is_deleted) return false;
    const status = it.ocr_status;
    if (status !== 'ocr_low' && status !== 'no_vision' && status !== 'rule_fallback') return false;
    if (it.classification_status !== 'review') return false;
    return !String(it.ai_reason || '').trim();
  });
}
