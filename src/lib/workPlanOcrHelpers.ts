/**
 * Pure helpers for Work-Plan Attachment OCR (Phase 1 MVP).
 * Zero browser/DOM/pdfjs dependencies so all logic is 100% unit-testable in Vitest.
 */

export type OcrFileSupportKind = "image" | "pdf" | "haansoft_pdf" | "unsupported";

export type ExpiryStatus = "expired" | "expiring_soon" | "valid" | "unknown";

export interface WorkPlanAttachmentOcrMeta {
  docCategoryLabel?: string | null;
  companyOrHolder?: string | null;
  regOrCertNo?: string | null;
  ratedCapacityTon?: number | null;
  summary?: string | null;
  confidence?: number | null;
  notes?: string | null;
  engine?: string | null;
}

export interface WorkPlanAttachmentOcrDbPatch {
  ocr_meta: WorkPlanAttachmentOcrMeta;
  doc_issue_date: string | null;
  doc_expiry_date: string | null;
  ocr_checked_at: string;
}

export interface WorkPlanOcrResult {
  ok: boolean;
  engine?: string;
  elapsedMs?: number;
  pageNumber: number;
  totalPages: number;
  suggestedKey: string | null;
  docCategoryLabel: string;
  confidence: number | null;
  companyOrHolder: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  expiryStatus: ExpiryStatus;
  regOrCertNo: string | null;
  ratedCapacityTon: number | null;
  summary: string | null;
  needsPageSelect: boolean;
  notes: string | null;
  error?: string;
}

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp)$/i;
const PDF_EXT_RE = /\.pdf$/i;

export function classifyOcrFileSupport(file: {
  name?: string | null;
  type?: string | null;
}): OcrFileSupportKind {
  const mime = String(file.type || "").toLowerCase().trim();
  const name = String(file.name || "").trim();

  if (mime === "application/haansoftpdf") return "haansoft_pdf";
  if (mime === "application/pdf" || PDF_EXT_RE.test(name)) return "pdf";
  if (mime.startsWith("image/") || IMAGE_EXT_RE.test(name)) return "image";
  return "unsupported";
}

const KEYWORD_WEIGHTS: Array<{ re: RegExp; weight: number }> = [
  { re: /정격하중|작업반경|인양하중|하중표|load\s*chart|rated\s*load/i, weight: 5 },
  { re: /검사유효|유효기간|차기검사|보험기간|보험종료|적성검사/i, weight: 4 },
  { re: /안전검사|정기검사|합격증|건설기계등록증|사업자등록증|보험가입증명/i, weight: 3 },
  { re: /조종사|운전면허|자격증|등록번호|제원표|아웃트리거/i, weight: 2 },
];

/**
 * Scores extracted text per page of a digital PDF and returns the 1-based page number
 * most likely to contain load charts, expiry dates, or key certificate fields.
 * Returns null when no page has meaningful keyword matches (e.g., scanned PDF).
 */
export function pickBestKeywordPage(pageTexts: string[]): number | null {
  let bestPage: number | null = null;
  let bestScore = 0;

  for (let i = 0; i < pageTexts.length; i += 1) {
    const text = String(pageTexts[i] || "");
    if (text.trim().length < 15) continue;
    let score = 0;
    for (const kw of KEYWORD_WEIGHTS) {
      if (kw.re.test(text)) score += kw.weight;
    }
    if (score > bestScore) {
      bestScore = score;
      bestPage = i + 1;
    }
  }
  return bestPage;
}

export function todayKstDateStr(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

/**
 * Classifies YYYY-MM-DD expiry date against KST today:
 * - expired: < today
 * - expiring_soon: within 30 days (0..30)
 * - valid: > 30 days
 */
export function evaluateExpiryStatus(
  expiryDate?: string | null,
  todayKst = todayKstDateStr(),
): ExpiryStatus {
  if (!expiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return "unknown";
  const expMs = Date.parse(`${expiryDate}T00:00:00Z`);
  const todayMs = Date.parse(`${todayKst}T00:00:00Z`);
  if (!Number.isFinite(expMs) || !Number.isFinite(todayMs)) return "unknown";
  const diffDays = Math.floor((expMs - todayMs) / (24 * 60 * 60 * 1000));
  if (diffDays < 0) return "expired";
  if (diffDays <= 30) return "expiring_soon";
  return "valid";
}

export function calcExpiryDaysRemaining(
  expiryDate?: string | null,
  todayKst = todayKstDateStr(),
): number | null {
  if (!expiryDate || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) return null;
  const expMs = Date.parse(`${expiryDate}T00:00:00Z`);
  const todayMs = Date.parse(`${todayKst}T00:00:00Z`);
  if (!Number.isFinite(expMs) || !Number.isFinite(todayMs)) return null;
  return Math.floor((expMs - todayMs) / (24 * 60 * 60 * 1000));
}

export function buildAttachmentOcrDbPatch(
  ocr: WorkPlanOcrResult | null | undefined,
  nowIso = new Date().toISOString(),
): WorkPlanAttachmentOcrDbPatch | null {
  if (!ocr || !ocr.ok) return null;
  const isYmd = (v: string | null | undefined): string | null =>
    v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  return {
    ocr_meta: {
      docCategoryLabel: ocr.docCategoryLabel || null,
      companyOrHolder: ocr.companyOrHolder ?? null,
      regOrCertNo: ocr.regOrCertNo ?? null,
      ratedCapacityTon: ocr.ratedCapacityTon ?? null,
      summary: ocr.summary ?? null,
      confidence: ocr.confidence ?? null,
      notes: ocr.notes ?? null,
      engine: ocr.engine ?? null,
    },
    doc_issue_date: isYmd(ocr.issueDate),
    doc_expiry_date: isYmd(ocr.expiryDate),
    ocr_checked_at: nowIso,
  };
}

export function addMonthsYmd(ymd: string, months: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  if (!Number.isFinite(dt.getTime())) return null;
  return dt.toISOString().slice(0, 10);
}

export function isNdtDocument(opts: {
  docCategoryLabel?: string | null;
  fileName?: string | null;
  slotName?: string | null;
}): boolean {
  const hay = `${opts.docCategoryLabel || ""} ${opts.fileName || ""} ${opts.slotName || ""}`;
  return /비파괴|ndt|자분탐상|초음파탐상|침투탐상/i.test(hay);
}

/**
 * Resolves effective expiry date for Non-Destructive Testing (비파괴검사) reports:
 * - Never treat inspection/issue date itself as expiry date.
 * - Equipment age >= 10 years: valid for 1 month from inspection (반입 1개월 이내).
 * - Equipment age < 10 years (or unknown): valid for 1 year from inspection (1년 이내),
 *   with an explicit note reminding reviewers of the 10yr+ 1-month rule.
 */
export function resolveNdtEffectiveExpiry(opts: {
  issueDate?: string | null;
  expiryDate?: string | null;
  equipmentYear?: number | null;
  todayKst?: string;
}): { expiryDate: string | null; note: string | null; ruleApplied: "ndt_10yr_1m" | "ndt_1yr" | "explicit" | "none" } {
  const issue = opts.issueDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.issueDate) ? opts.issueDate : null;
  const rawExp = opts.expiryDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.expiryDate) ? opts.expiryDate : null;
  // Guard: AI sometimes puts the inspection date itself into expiry_date
  const explicitExp = rawExp && rawExp !== issue ? rawExp : null;
  if (explicitExp) {
    return { expiryDate: explicitExp, note: null, ruleApplied: "explicit" };
  }
  if (!issue) {
    return { expiryDate: null, note: null, ruleApplied: "none" };
  }

  const today = opts.todayKst || todayKstDateStr();
  const currentYear = Number(today.slice(0, 4));
  const eqYear =
    typeof opts.equipmentYear === "number" && opts.equipmentYear >= 1970 && opts.equipmentYear <= currentYear + 1
      ? opts.equipmentYear
      : null;

  if (eqYear != null && currentYear - eqYear >= 10) {
    return {
      expiryDate: addMonthsYmd(issue, 1),
      note: `10년 이상 장비(${eqYear}년식) 기준 적용: 검사일(${issue})로부터 1개월 이내 반입 필요`,
      ruleApplied: "ndt_10yr_1m",
    };
  }

  return {
    expiryDate: addMonthsYmd(issue, 12),
    note:
      eqYear != null
        ? `10년 미만 장비(${eqYear}년식) 비파괴검사 1년 유효 기준 적용`
        : "비파괴검사 1년 유효 기준 적용 (※ 10년 이상 장비는 반입 1개월 이내 검사 필요)",
    ruleApplied: "ndt_1yr",
  };
}

export function normalizeOcrResponse(
  raw: Record<string, unknown> | null | undefined,
  opts: {
    allowedKeys: Set<string>;
    pageNumber: number;
    totalPages: number;
    todayKst?: string;
  },
): WorkPlanOcrResult {
  if (!raw || raw.ok !== true) {
    return {
      ok: false,
      pageNumber: opts.pageNumber,
      totalPages: opts.totalPages,
      suggestedKey: null,
      docCategoryLabel: "판독 실패",
      confidence: null,
      companyOrHolder: null,
      issueDate: null,
      expiryDate: null,
      expiryStatus: "unknown",
      regOrCertNo: null,
      ratedCapacityTon: null,
      summary: null,
      needsPageSelect: opts.totalPages > 1,
      notes: null,
      error:
        typeof raw?.error === "string" && raw.error.trim()
          ? raw.error.trim()
          : "AI 서류 판독에 실패했습니다. 수동으로 항목을 선택해 주세요.",
    };
  }

  const rawKey = typeof raw.suggested_key === "string" ? raw.suggested_key.trim() : "";
  const suggestedKey = rawKey && opts.allowedKeys.has(rawKey) ? rawKey : null;
  const expiryDate = typeof raw.expiry_date === "string" ? raw.expiry_date : null;

  return {
    ok: true,
    engine: typeof raw.engine === "string" ? raw.engine : undefined,
    elapsedMs: typeof raw.elapsed_ms === "number" ? raw.elapsed_ms : undefined,
    pageNumber: opts.pageNumber,
    totalPages: opts.totalPages,
    suggestedKey,
    docCategoryLabel:
      typeof raw.doc_category_label === "string" && raw.doc_category_label.trim()
        ? raw.doc_category_label.trim()
        : "기타",
    confidence: typeof raw.confidence === "number" ? raw.confidence : null,
    companyOrHolder:
      typeof raw.company_or_holder === "string" ? raw.company_or_holder : null,
    issueDate: typeof raw.issue_date === "string" ? raw.issue_date : null,
    expiryDate,
    expiryStatus: evaluateExpiryStatus(expiryDate, opts.todayKst),
    regOrCertNo: typeof raw.reg_or_cert_no === "string" ? raw.reg_or_cert_no : null,
    ratedCapacityTon:
      typeof raw.rated_capacity_ton === "number" ? raw.rated_capacity_ton : null,
    summary: typeof raw.summary === "string" ? raw.summary : null,
    needsPageSelect: Boolean(raw.needs_page_select),
    notes: typeof raw.notes === "string" ? raw.notes : null,
  };
}
