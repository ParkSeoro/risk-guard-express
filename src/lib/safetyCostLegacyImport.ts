import { SAFETY_COST_CATEGORIES, classifySafetyCostItem } from '@/lib/safetyCost';

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
  const quantity = toNum(row.quantity ?? row['수량']) || 1;
  const unitPrice = toNum(row.unit_price ?? row['단가']);
  const supply = toNum(row.supply_amount ?? row['공급가액']);
  const vat = toNum(row.vat_amount ?? row['부가세']);
  const supplyAmount = supply || (unitPrice ? quantity * unitPrice : Math.max(amount - vat, 0));
  const code = String(row.category_code || fallback.category_code || '');
  const cat = SAFETY_COST_CATEGORIES.find((c) => c.code === code);
  return {
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
  };
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
    const item = normalizeLegacyItem({ item_name: name, amount });
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
    return {
      report_month,
      title: String(m.title || `${report_month} 산업안전보건관리비 사용내역서(이관)`),
      declared_total: m.declared_total != null ? toNum(m.declared_total) : lineTotal,
      category_totals: m.category_totals && typeof m.category_totals === 'object' ? m.category_totals : undefined,
      items,
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
