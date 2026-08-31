import {
  SAFETY_COST_CATEGORIES,
  classifySafetyCostItem,
  emptySafetyCostByCategory,
  sumSafetyCostByCategory,
} from '@/lib/safetyCost';
import { isSafetyCostOcrStatus, stampOcrOnItem, type SafetyCostOcrStatus } from '@/lib/safetyCostOcr';

export type LegacyImportItem = {
  transaction_date?: string;
  usage_date?: string;
  item_name: string;
  specification?: string;
  maker?: string;
  quantity?: number;
  unit?: string;
  unit_price?: number;
  supply_amount?: number;
  vat_amount?: number;
  amount: number;
  supplier_name?: string;
  category_code?: string;
  category_name?: string;
  classification_status?: string;
  ai_confidence?: number;
  ai_reason?: string;
  legal_basis?: string;
  ocr_status?: SafetyCostOcrStatus;
  ocr_raw_text?: string;
  ocr_confidence?: number;
};

export type LegacyImportPpeIssuance = {
  issued_at?: string;
  worker_name: string;
  item_name: string;
  quantity?: number;
  signature_note?: string;
};

export type LegacyImportMonth = {
  report_month: string; // YYYY-MM or YYYY-MM-01
  title?: string;
  declared_total?: number;
  category_totals?: Record<string, number>;
  items: LegacyImportItem[];
  ppe_issuances?: LegacyImportPpeIssuance[];
  included?: boolean;
};

export type LegacyImportConstructionMeta = {
  construction_name?: string;
  construction_type?: string;
  construction_amount?: number;
  safety_cost_total?: number;
};

export type LegacyImportDraft = {
  construction?: LegacyImportConstructionMeta;
  months: LegacyImportMonth[];
  summary?: {
    declared_cumulative?: number;
    declared_remaining?: number;
    notes?: string[];
  };
  extraction_warning?: string;
};

export type LegacyValidationIssue = {
  level: 'error' | 'warning';
  code: string;
  message: string;
  month?: string;
};

export type LegacyValidationResult = {
  ok: boolean;
  canCommit: boolean;
  issues: LegacyValidationIssue[];
  monthChecks: Array<{
    report_month: string;
    lineTotal: number;
    declaredTotal: number;
    delta: number;
    itemCount: number;
  }>;
  computedCumulative: number;
};

const toNum = (v: unknown) => {
  const n = Number(String(v ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const normalizeMonth = (raw: string) => {
  const s = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 7);
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  if (/^\d{4}\.\d{1,2}$/.test(s)) {
    const [y, m] = s.split('.');
    return `${y}-${m.padStart(2, '0')}`;
  }
  if (/^\d{4}\/\d{1,2}$/.test(s)) {
    const [y, m] = s.split('/');
    return `${y}-${m.padStart(2, '0')}`;
  }
  return s;
};

export function normalizeLegacyItem(row: Partial<LegacyImportItem> & Record<string, unknown>): LegacyImportItem | null {
  const name = String(row.item_name || row['품목'] || row['사용 항목'] || '').trim();
  const amount = toNum(row.amount ?? row['금액'] ?? row['합계']);
  if (!name || amount <= 0) return null;
  const fallback = classifySafetyCostItem(name);
  const qtyRaw = row.quantity ?? row['수량'];
  const parsedQty = qtyRaw === '' || qtyRaw == null ? NaN : toNum(qtyRaw);
  const quantity = Number.isFinite(parsedQty) ? parsedQty : 1;
  const unitPrice = toNum(row.unit_price ?? row['단가']);
  const supply = toNum(row.supply_amount ?? row['공급가액']);
  const vat = toNum(row.vat_amount ?? row['부가세']);
  const supplyAmount = supply || (unitPrice ? quantity * unitPrice : Math.max(amount - vat, 0));
  const code = String(row.category_code || fallback.category_code || '');
  const cat = SAFETY_COST_CATEGORIES.find((c) => c.code === code);
  const base = {
    transaction_date: String(row.transaction_date || row.usage_date || '') || undefined,
    usage_date: String(row.usage_date || row.transaction_date || '') || undefined,
    item_name: name,
    specification: String(row.specification || row['규격'] || ''),
    maker: String(row.maker || row['메이커'] || row['제조사'] || ''),
    quantity,
    unit: String(row.unit || row['단위'] || '식'),
    unit_price: unitPrice || (quantity ? Math.round(supplyAmount / quantity) : amount),
    supply_amount: supplyAmount,
    vat_amount: vat,
    amount: supplyAmount + vat || amount,
    supplier_name: String(row.supplier_name || row['공급자'] || row['상호'] || ''),
    category_code: code,
    category_name: String(row.category_name || cat?.name || fallback.category_name),
    classification_status: String(row.classification_status || fallback.classification_status),
    ai_confidence: row.ai_confidence != null ? Number(row.ai_confidence) : undefined,
    ai_reason: String(row.ai_reason || fallback.ai_reason || ''),
    legal_basis: String(row.legal_basis || fallback.legal_basis || ''),
    ocr_status: isSafetyCostOcrStatus(row.ocr_status) ? row.ocr_status : undefined,
    ocr_raw_text: String(row.ocr_raw_text || '').slice(0, 2000) || undefined,
    ocr_confidence: row.ocr_confidence != null && Number.isFinite(Number(row.ocr_confidence))
      ? Number(row.ocr_confidence)
      : undefined,
  };
  return stampOcrOnItem(base, {
    engine: base.ocr_status === 'rule_fallback' ? 'rule' : undefined,
    confidence: base.ocr_confidence,
    rawText: base.ocr_raw_text,
    fieldsCorrected: base.ocr_status === 'ai_corrected' || row.fields_corrected === true,
    noVision: base.ocr_status === 'no_vision',
    userEdited: base.ocr_status === 'user_edited',
  });
}

/** 텍스트/CSV에서 월·금액 라인을 예비 추출 (AI 없을 때·보조) */
export function parseLegacyTextDraft(text: string): LegacyImportDraft {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const monthsMap = new Map<string, LegacyImportMonth>();
  let currentMonth = '';

  for (const line of lines) {
    const monthHit = line.match(/(20\d{2})[.\-\/년\s]+(\d{1,2})\s*월?/);
    if (monthHit && /사용|내역|월별|집계|승인/.test(line)) {
      currentMonth = `${monthHit[1]}-${monthHit[2].padStart(2, '0')}`;
      if (!monthsMap.has(currentMonth)) {
        monthsMap.set(currentMonth, {
          report_month: currentMonth,
          title: `${currentMonth} 산업안전보건관리비 사용내역서(이관)`,
          items: [],
          ppe_issuances: [],
          included: true,
        });
      }
    }

    const amountMatch = line.match(/([0-9,]{3,})\s*원?$/);
    if (!amountMatch) continue;
    const amount = toNum(amountMatch[1]);
    const name = line.replace(amountMatch[0], '').replace(/^[|\-\s]+/, '').trim();
    if (!name || amount <= 0 || name.length < 2) continue;
    if (/합계|소계|누계|총액|잔여|계상/.test(name) && name.length < 12) {
      if (currentMonth && monthsMap.has(currentMonth) && /합계|총액/.test(name)) {
        monthsMap.get(currentMonth)!.declared_total = amount;
      }
      continue;
    }
    if (!currentMonth) {
      currentMonth = 'unknown';
      monthsMap.set(currentMonth, {
        report_month: currentMonth,
        title: '미지정월 사용내역(이관)',
        items: [],
        included: true,
      });
    }
    const item = normalizeLegacyItem({
      item_name: name,
      amount,
      ocr_status: 'rule_fallback',
      ocr_raw_text: line,
      ocr_confidence: 0.3,
    });
    if (item) monthsMap.get(currentMonth)!.items.push(item);
  }

  const months = [...monthsMap.values()].filter((m) => m.report_month !== 'unknown' || m.items.length);
  return {
    months,
    summary: {
      notes: ['텍스트 예비 추출입니다. AI 추출·검수 후 확정하세요.'],
    },
    extraction_warning: '규칙 기반 예비 추출 — 숫자·비목 대조가 필요합니다.',
  };
}

export function normalizeLegacyDraft(raw: unknown): LegacyImportDraft {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const monthsRaw = Array.isArray(src.months) ? src.months : [];
  const months: LegacyImportMonth[] = monthsRaw.map((m: any) => {
    const report_month = normalizeMonth(String(m.report_month || m.month || ''));
    const items = (Array.isArray(m.items) ? m.items : [])
      .map((it: any) => normalizeLegacyItem(it))
      .filter(Boolean) as LegacyImportItem[];
    const ppe = (Array.isArray(m.ppe_issuances) ? m.ppe_issuances : [])
      .map((p: any) => ({
        issued_at: String(p.issued_at || '') || undefined,
        worker_name: String(p.worker_name || p.name || '').trim(),
        item_name: String(p.item_name || '').trim(),
        quantity: toNum(p.quantity) || 1,
        signature_note: String(p.signature_note || ''),
      }))
      .filter((p: LegacyImportPpeIssuance) => p.worker_name && p.item_name);
    const lineTotal = items.reduce((s, it) => s + Number(it.amount || 0), 0);
    const declaredTotal = m.declared_total != null ? toNum(m.declared_total) : lineTotal;
    const mismatch = Math.abs(lineTotal - declaredTotal) > 1;
    const stampedItems = mismatch
      ? items.map((it) => (
        it.ocr_status === 'user_edited' || it.ocr_status === 'no_vision'
          ? it
          : { ...it, ocr_status: 'ocr_low' as const }
      ))
      : items;
    return {
      report_month,
      title: String(m.title || `${report_month} 산업안전보건관리비 사용내역서(이관)`),
      declared_total: declaredTotal,
      category_totals: m.category_totals && typeof m.category_totals === 'object' ? m.category_totals : undefined,
      items: stampedItems,
      ppe_issuances: ppe,
      included: m.included !== false,
    };
  }).filter((m) => m.report_month);

  const c = (src.construction && typeof src.construction === 'object' ? src.construction : {}) as Record<string, unknown>;
  return {
    construction: {
      construction_name: String(c.construction_name || '') || undefined,
      construction_type: String(c.construction_type || '') || undefined,
      construction_amount: c.construction_amount != null ? toNum(c.construction_amount) : undefined,
      safety_cost_total: c.safety_cost_total != null ? toNum(c.safety_cost_total) : undefined,
    },
    months,
    summary: (src.summary as LegacyImportDraft['summary']) || {},
    extraction_warning: String(src.extraction_warning || '') || undefined,
  };
}

const AMOUNT_TOLERANCE = 1; // 원

export function validateLegacyDraft(
  draft: LegacyImportDraft,
  opts?: { safetyCostTotal?: number; existingApprovedTotal?: number },
): LegacyValidationResult {
  const issues: LegacyValidationIssue[] = [];
  const included = draft.months.filter((m) => m.included !== false);
  if (!included.length) {
    issues.push({ level: 'error', code: 'NO_MONTHS', message: '확정할 월이 없습니다.' });
  }

  const monthChecks = included.map((m) => {
    const lineTotal = m.items.reduce((s, it) => s + Number(it.amount || 0), 0);
    const declaredTotal = m.declared_total != null ? Number(m.declared_total) : lineTotal;
    const delta = Math.abs(lineTotal - declaredTotal);
    if (!m.items.length) {
      issues.push({
        level: 'error',
        code: 'EMPTY_MONTH',
        message: `${m.report_month}: 항목이 없습니다.`,
        month: m.report_month,
      });
    }
    if (delta > AMOUNT_TOLERANCE) {
      issues.push({
        level: 'error',
        code: 'MONTH_TOTAL_MISMATCH',
        message: `${m.report_month}: 라인합(${lineTotal.toLocaleString()}) ≠ 신고총액(${declaredTotal.toLocaleString()})`,
        month: m.report_month,
      });
    }
    const missingCat = m.items.filter((it) => !it.category_code).length;
    if (missingCat > 0) {
      issues.push({
        level: 'warning',
        code: 'MISSING_CATEGORY',
        message: `${m.report_month}: 비목 미지정 ${missingCat}건`,
        month: m.report_month,
      });
    }
    return {
      report_month: m.report_month,
      lineTotal,
      declaredTotal,
      delta,
      itemCount: m.items.length,
    };
  });

  const computedCumulative = monthChecks.reduce((s, m) => s + m.lineTotal, 0);
  const declaredCum = draft.summary?.declared_cumulative;
  if (declaredCum != null && Math.abs(computedCumulative - Number(declaredCum)) > AMOUNT_TOLERANCE) {
    issues.push({
      level: 'warning',
      code: 'CUMULATIVE_MISMATCH',
      message: `추출 누계(${Number(declaredCum).toLocaleString()})와 라인 누계(${computedCumulative.toLocaleString()})가 다릅니다.`,
    });
  }

  const budget = Number(opts?.safetyCostTotal || draft.construction?.safety_cost_total || 0);
  const existing = Number(opts?.existingApprovedTotal || 0);
  if (budget > 0 && existing + computedCumulative > budget + AMOUNT_TOLERANCE) {
    issues.push({
      level: 'error',
      code: 'OVER_BUDGET',
      message: `이관 후 승인누계가 계상총액을 초과합니다.`,
    });
  }

  const hasError = issues.some((i) => i.level === 'error');
  return {
    ok: !hasError,
    canCommit: !hasError && included.length > 0,
    issues,
    monthChecks,
    computedCumulative,
  };
}

export type LiveMonthRow = {
  report_month?: string | null;
  status?: string | null;
  is_deleted?: boolean | null;
};

export type LegacyCommitMonthPlan = {
  report_month: string;
  action: 'insert' | 'reject_live';
  liveStatus?: string | null;
};

/** 이관 확정 플래너: 이미 살아있는 월보는 덮어쓰지 않는다. */
export function planLegacyCommitMonths(
  draft: LegacyImportDraft,
  liveRows: LiveMonthRow[],
): { ok: boolean; blockers: string[]; plans: LegacyCommitMonthPlan[] } {
  const included = draft.months.filter((m) => m.included !== false);
  const liveByMonth = new Map<string, LiveMonthRow>();
  for (const row of liveRows) {
    if (row.is_deleted) continue;
    const key = String(row.report_month || '').slice(0, 7);
    if (key) liveByMonth.set(key, row);
  }
  const plans: LegacyCommitMonthPlan[] = [];
  const blockers: string[] = [];
  for (const month of included) {
    const live = liveByMonth.get(month.report_month);
    if (live) {
      plans.push({ report_month: month.report_month, action: 'reject_live', liveStatus: live.status || null });
      blockers.push(`${month.report_month}: 이미 ${live.status === 'approved' ? '승인된' : '작성 중인'} 월보가 있어 이관할 수 없습니다.`);
    } else {
      plans.push({ report_month: month.report_month, action: 'insert' });
    }
  }
  return { ok: blockers.length === 0, blockers, plans };
}

export function buildCommitPreview(draft: LegacyImportDraft) {
  const included = draft.months.filter((m) => m.included !== false);
  return {
    monthCount: included.length,
    itemCount: included.reduce((s, m) => s + m.items.length, 0),
    ppeIssuanceCount: included.reduce((s, m) => s + (m.ppe_issuances?.length || 0), 0),
    ppeInboundCount: included.reduce(
      (s, m) => s + m.items.filter((it) => it.category_code === '3' && Number(it.quantity || 0) > 0).length,
      0,
    ),
    totalAmount: included.reduce((s, m) => s + m.items.reduce((a, it) => a + Number(it.amount || 0), 0), 0),
  };
}

export const emptyCategoryAmounts = emptySafetyCostByCategory;

export function parseWonInput(raw: string | number | null | undefined) {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(0, Math.round(raw));
  const n = Number(String(raw ?? '').replace(/,/g, '').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n));
}

export function shiftMonthKey(ym: string, delta: number) {
  const m = String(ym || '').slice(0, 7).match(/^(\d{4})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function previousCalendarMonth(now = new Date()) {
  return shiftMonthKey(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, -1);
}

/** 그리드에 넣을 다음 월. 기존 월보·이미 적힌 월은 건너뛴다. */
export function suggestNextImportMonth(gridMonths: string[], liveMonths: string[] = [], now = new Date()) {
  const taken = new Set(
    [...gridMonths, ...liveMonths]
      .map((m) => String(m || '').slice(0, 7))
      .filter((k) => /^\d{4}-\d{2}$/.test(k)),
  );
  const prev = previousCalendarMonth(now);
  const gridFilled = gridMonths.map((m) => String(m || '').slice(0, 7)).filter((k) => /^\d{4}-\d{2}$/.test(k)).sort();
  if (!gridFilled.length) {
    let candidate = prev;
    for (let i = 0; i < 60; i += 1) {
      if (!taken.has(candidate)) return candidate;
      candidate = shiftMonthKey(candidate, -1);
    }
    return prev;
  }
  let candidate = shiftMonthKey(gridFilled[gridFilled.length - 1], 1);
  for (let i = 0; i < 36; i += 1) {
    if (!taken.has(candidate)) return candidate;
    candidate = shiftMonthKey(candidate, 1);
  }
  return candidate;
}

/** 승인본 이관은 최초 1회용. 누계·월보가 있으면 접고, 둘 다 없을 때만 자동으로 연다. */
export function shouldExpandLegacyImportWizard(opts: {
  approvedTotal?: number | null;
  liveReportCount?: number | null;
}): boolean {
  const approved = Number(opts.approvedTotal || 0);
  const lives = Number(opts.liveReportCount || 0);
  return approved <= 0 && lives <= 0;
}

export type LegacyCategoryGridRow = {
  report_month: string;
  amounts: Record<string, number>;
  declared_total?: number | null;
  included?: boolean;
};

export type CategoryGridMonthSummary = {
  report_month: string;
  monthTotal: number;
  declared_total: number | null | undefined;
  amounts: Record<string, number>;
  categoryCumulatives: Record<string, number>;
};

export type CategoryGridSummary = {
  monthRows: CategoryGridMonthSummary[];
  importTotal: number;
  importByCategory: Record<string, number>;
  afterCumulatives: Record<string, number>;
  afterGrand: number;
};

export function summarizeCategoryGrid(
  rows: LegacyCategoryGridRow[],
  existingByCategory?: Record<string, number>,
): CategoryGridSummary {
  const included = rows
    .filter((r) => r.included !== false)
    .slice()
    .sort((a, b) => a.report_month.localeCompare(b.report_month));
  const run = emptyCategoryAmounts();
  SAFETY_COST_CATEGORIES.forEach((c) => {
    run[c.code] = Number(existingByCategory?.[c.code] || 0);
  });
  const importByCategory = emptyCategoryAmounts();
  const monthRows = included.map((r) => {
    let monthTotal = 0;
    SAFETY_COST_CATEGORIES.forEach((c) => {
      const n = parseWonInput(r.amounts[c.code]);
      monthTotal += n;
      importByCategory[c.code] += n;
      run[c.code] += n;
    });
    return {
      report_month: r.report_month,
      monthTotal,
      declared_total: r.declared_total,
      amounts: { ...emptyCategoryAmounts(), ...r.amounts },
      categoryCumulatives: { ...run },
    };
  });
  const importTotal = monthRows.reduce((s, m) => s + m.monthTotal, 0);
  const afterGrand = SAFETY_COST_CATEGORIES.reduce((s, c) => s + run[c.code], 0);
  return { monthRows, importTotal, importByCategory, afterCumulatives: { ...run }, afterGrand };
}

/** 비목 금월 금액 → 월보 항목. 수량 0이라 보호구 재고 입고가 생기지 않는다. */
export function itemsFromCategoryAmounts(reportMonth: string, amounts: Record<string, number>): LegacyImportItem[] {
  const monthKey = String(reportMonth || '').slice(0, 7);
  const monthDate = /^\d{4}-\d{2}$/.test(monthKey) ? `${monthKey}-01` : '';
  return SAFETY_COST_CATEGORIES.flatMap((cat) => {
    const amount = parseWonInput(amounts[cat.code]);
    if (amount <= 0) return [];
    return [{
      transaction_date: monthDate,
      usage_date: monthDate,
      item_name: `${cat.name} (이관 총괄)`,
      specification: '승인본 총괄',
      maker: '',
      quantity: 0,
      unit: '식',
      unit_price: 0,
      supply_amount: amount,
      vat_amount: 0,
      amount,
      supplier_name: '',
      category_code: cat.code,
      category_name: cat.name,
      classification_status: 'usable',
      ai_reason: '승인본 총괄표 이관. 거래명세 단위가 아니라 비목 금월 금액이다.',
      legal_basis: '건설업 산업안전보건관리비 계상 및 사용기준 제10조',
      ocr_status: 'user_edited' as const,
    }];
  });
}

export function draftFromCategoryGrid(
  rows: LegacyCategoryGridRow[],
  construction?: LegacyImportConstructionMeta,
  summary?: { declared_cumulative?: number | null },
): LegacyImportDraft {
  const months: LegacyImportMonth[] = rows
    .filter((r) => r.included !== false)
    .map((r) => {
      const items = itemsFromCategoryAmounts(r.report_month, r.amounts);
      const lineTotal = items.reduce((s, it) => s + Number(it.amount || 0), 0);
      const declared = r.declared_total == null ? lineTotal : parseWonInput(r.declared_total);
      return {
        report_month: String(r.report_month || '').slice(0, 7),
        title: `${String(r.report_month || '').slice(0, 7)} 산업안전보건관리비 사용내역서(이관)`,
        declared_total: declared,
        category_totals: { ...emptyCategoryAmounts(), ...r.amounts },
        items,
        ppe_issuances: [],
        included: true,
      };
    });
  const declaredCum = summary?.declared_cumulative;
  return {
    construction,
    months,
    summary: {
      declared_cumulative: declaredCum == null ? undefined : parseWonInput(declaredCum),
      notes: ['승인본 총괄 비목 금액 수기 이관'],
    },
  };
}

export type CategoryGridValidation = LegacyValidationResult & {
  summary: CategoryGridSummary;
  draft: LegacyImportDraft;
  liveBlockers: string[];
};

export function validateCategoryGrid(
  rows: LegacyCategoryGridRow[],
  opts?: {
    safetyCostTotal?: number;
    existingApprovedTotal?: number;
    existingApprovedByCategory?: Record<string, number>;
    liveReports?: LiveMonthRow[];
    declaredCumulative?: number | null;
  },
): CategoryGridValidation {
  const issues: LegacyValidationIssue[] = [];
  const included = rows.filter((r) => r.included !== false);
  const seen = new Set<string>();
  for (const row of included) {
    const month = String(row.report_month || '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) {
      issues.push({
        level: 'error',
        code: 'INVALID_MONTH',
        message: `작성월 형식이 아닙니다: ${month || '(빈 칸)'}`,
        month,
      });
    } else if (seen.has(month)) {
      issues.push({
        level: 'error',
        code: 'DUPLICATE_MONTH',
        message: `${month}: 같은 월이 두 번 있습니다.`,
        month,
      });
    }
    seen.add(month);
  }

  const existingByCat = opts?.existingApprovedByCategory || emptyCategoryAmounts();
  const priorCatSum = SAFETY_COST_CATEGORIES.reduce((s, c) => s + Number(existingByCat[c.code] || 0), 0);
  const existingTotal = Number(opts?.existingApprovedTotal || 0);
  if (existingTotal > 0 && Math.abs(priorCatSum - existingTotal) > AMOUNT_TOLERANCE) {
    issues.push({
      level: 'warning',
      code: 'PRIOR_CATEGORY_GAP',
      message: `기존 승인 누계(${existingTotal.toLocaleString()}원)와 비목 합(${priorCatSum.toLocaleString()}원)이 다릅니다. 비목이 없는 과거 월이 있으면 다음 달 총괄 전월 칸이 부족합니다.`,
    });
  }

  const draft = draftFromCategoryGrid(included, { safety_cost_total: opts?.safetyCostTotal });
  const base = validateLegacyDraft(draft, {
    safetyCostTotal: opts?.safetyCostTotal,
    existingApprovedTotal: opts?.existingApprovedTotal,
  });
  const plan = planLegacyCommitMonths(draft, opts?.liveReports || []);
  const liveIssues: LegacyValidationIssue[] = plan.blockers.map((message) => ({
    level: 'error' as const,
    code: 'LIVE_MONTH',
    message,
  }));
  const summary = summarizeCategoryGrid(included, existingByCat);
  const afterApproved = existingTotal + summary.importTotal;
  if (opts?.declaredCumulative != null && Math.abs(afterApproved - parseWonInput(opts.declaredCumulative)) > AMOUNT_TOLERANCE) {
    issues.push({
      level: 'error',
      code: 'CUMULATIVE_MISMATCH',
      message: `문서 최종 누계(${parseWonInput(opts.declaredCumulative).toLocaleString()}원)와 이관 후 승인 누계(${afterApproved.toLocaleString()}원)가 다릅니다.`,
    });
  }

  const upgraded = [...issues, ...liveIssues, ...base.issues];
  const hasError = upgraded.some((i) => i.level === 'error');
  return {
    ok: !hasError,
    canCommit: !hasError && included.length > 0 && base.monthChecks.every((m) => m.itemCount > 0),
    issues: upgraded,
    monthChecks: base.monthChecks,
    computedCumulative: base.computedCumulative,
    summary,
    draft,
    liveBlockers: plan.blockers,
  };
}

export function mapLegacyCommitError(message: string, hint?: string) {
  const raw = String(message || '');
  if (/live_month_exists/i.test(raw)) return `${hint || '해당 월'}에 이미 월보가 있어 이관할 수 없습니다.`;
  if (/over_budget/i.test(raw)) return '이관 후 승인 누계가 계상총액을 초과합니다.';
  if (/budget_not_confirmed/i.test(raw)) return '계상총액 대조를 확인하세요.';
  if (/no_months/i.test(raw)) return '확정할 월이 없습니다.';
  if (/already_committed/i.test(raw)) return '이미 확정된 이관입니다.';
  if (/unauthenticated/i.test(raw)) return '로그인이 필요합니다.';
  if (/forbidden/i.test(raw)) return '이관 권한이 없습니다.';
  return raw;
}

/** 엑셀·인쇄 총괄 전월 칸과 동일한 비목 합. */
export function approvedByCategoryFromItems(
  items: Array<{ report_id?: string | null; category_code?: string | null; category_name?: string | null; amount?: number | string | null; is_deleted?: boolean | null }>,
  priorReportIds: Set<string>,
) {
  return sumSafetyCostByCategory(items.filter((it) => it.report_id && priorReportIds.has(it.report_id)));
}
