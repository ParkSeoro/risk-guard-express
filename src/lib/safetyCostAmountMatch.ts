import { formatKRW, SAFETY_COST_CATEGORIES } from '@/lib/safetyCost';
import { parseSafetyCostMoneyNote, sameWon } from '@/lib/safetyCostMoneyNote';

/** 발주처 규정. 고시 한도가 아니다. 나중에 현장 설정으로 바꿀 수 있게 한 곳에 둔다. */
export const OWNER_LABOR_NOTICE_RATIO = 0.3;
export const OWNER_LABOR_MAX_RATIO = 0.5;
export const LABOR_CATEGORY_CODES = ['1', '8'] as const;

export type AmountRow = {
  id: string;
  category_code?: string | null;
  item_name?: string | null;
  supplier_name?: string | null;
  amount?: number | string | null;
  supply_amount?: number | string | null;
  vat_amount?: number | string | null;
};

export type AmountFile = {
  id?: string;
  item_id?: string | null;
  category_code?: string | null;
  evidence_kind?: string | null;
  file_name?: string | null;
  file_path?: string | null;
  note?: string | null;
};

export type AmountNotice = {
  blocking: boolean;
  message: string;
  fileId?: string;
};

function won(value: number): string {
  return formatKRW(value);
}

function categoryName(code: string): string {
  return SAFETY_COST_CATEGORIES.find((c) => c.code === code)?.name || code;
}

export function listAmountNotices(items: AmountRow[], files: AmountFile[]): AmountNotice[] {
  const notices: AmountNotice[] = [];
  for (const item of items) {
    const supply = Number(item.supply_amount || 0);
    const vat = Number(item.vat_amount || 0);
    const amount = Number(item.amount || 0);
    if (supply + vat <= 0) continue;
    if (sameWon(supply + vat, amount)) continue;
    const name = item.item_name || '항목';
    const who = item.supplier_name ? `(${item.supplier_name})` : '';
    notices.push({
      blocking: true,
      message: `${name}${who}: 공급가액+부가세 ${won(supply + vat)}, 내역 ${won(amount)}. ${won(Math.abs(supply + vat - amount))} 차이.`,
    });
  }

  const transactions = files.filter((f) => f.evidence_kind === 'transaction');
  const byPath = new Map<string, AmountFile[]>();
  for (const file of transactions) {
    const key = file.file_path || file.id || file.file_name || '';
    const list = byPath.get(key) || [];
    list.push(file);
    byPath.set(key, list);
  }
  for (const group of byPath.values()) {
    const parsed = group.map((f) => parseSafetyCostMoneyNote(f.note).total).find((n) => n != null);
    const linked = items.filter((item) => group.some((f) => f.item_id && f.item_id === item.id));
    const label = linked[0]?.item_name || group[0]?.file_name || '거래명세서';
    const who = linked[0]?.supplier_name ? `(${linked[0].supplier_name})` : '';
    if (parsed == null) {
      if (linked.length) {
        notices.push({
          blocking: false,
          message: `${label}${who}: 거래명세서 합계를 적어 주세요.`,
          fileId: group[0]?.id,
        });
      }
      continue;
    }
    const sum = linked.reduce((s, item) => s + Number(item.amount || 0), 0);
    if (sameWon(sum, parsed)) continue;
    notices.push({
      blocking: true,
      message: `${label}${who}: 내역 ${won(sum)}, 거래명세서 ${won(parsed)}. ${won(Math.abs(sum - parsed))} ${sum > parsed ? '거래명세서 부족' : '거래명세서 초과'}.`,
    });
  }

  const taxes = files.filter((f) => f.evidence_kind === 'tax_invoice');
  const taxGroups = new Map<string, AmountFile[]>();
  for (const file of taxes) {
    const key = file.file_path || file.id || file.file_name || '';
    const list = taxGroups.get(key) || [];
    list.push(file);
    taxGroups.set(key, list);
  }
  for (const group of taxGroups.values()) {
    const parsed = group.map((f) => parseSafetyCostMoneyNote(f.note));
    const total = parsed.find((p) => p.total != null)?.total ?? null;
    const parts = parsed.filter((p) => p.part != null);
    const name = group[0]?.file_name || '세금계산서';
    if (total != null && parts.length) {
      const partSum = parts.reduce((s, p) => s + Number(p.part || 0), 0);
      if (!sameWon(partSum, total)) {
        const missing = Math.abs(total - partSum);
        const short = group.map((f) => categoryName(String(f.category_code || ''))).filter(Boolean).join(', ');
        notices.push({
          blocking: true,
          message: `${name}: 총액 ${won(total)}, 비목 배분 합 ${won(partSum)}. ${short || '비목'}에 ${won(missing)} ${partSum < total ? '빠짐' : '넘침'}.`,
        });
      }
    }
    for (const file of group) {
      const money = parseSafetyCostMoneyNote(file.note);
      const code = String(file.category_code || '');
      if (!code || money.part == null) continue;
      const sameCategoryFiles = taxes.filter((f) => String(f.category_code || '') === code && (f.file_path || f.id) !== (file.file_path || file.id));
      if (sameCategoryFiles.length) continue;
      const catSum = items.filter((item) => String(item.category_code || '') === code).reduce((s, item) => s + Number(item.amount || 0), 0);
      if (sameWon(catSum, money.part)) continue;
      notices.push({
        blocking: true,
        message: `${categoryName(code)}: 내역 합계 ${won(catSum)}, 계산서 배분 ${won(money.part)}. ${won(Math.abs(catSum - money.part))} 차이.`,
      });
    }
  }
  return notices;
}

export type LaborRatioLevel = 'ok' | 'approval' | 'over';

export function laborRatioStatus(input: {
  monthLabor: number;
  monthTotal: number;
  cumulativeLabor: number;
  budget: number | null;
}): {
  monthRatio: number | null;
  cumulativeRatio: number | null;
  level: LaborRatioLevel;
  monthMessage: string;
  cumulativeMessage: string;
} {
  const monthRatio = input.monthTotal > 0 ? Math.round((input.monthLabor / input.monthTotal) * 1000) / 10 : null;
  const cumulativeRatio = input.budget != null && input.budget > 0
    ? Math.round((input.cumulativeLabor / input.budget) * 1000) / 10
    : null;
  let level: LaborRatioLevel = 'ok';
  if (monthRatio != null && monthRatio > OWNER_LABOR_MAX_RATIO * 100) level = 'over';
  else if (monthRatio != null && monthRatio > OWNER_LABOR_NOTICE_RATIO * 100) level = 'approval';
  const monthMessage = monthRatio == null
    ? ''
    : level === 'over'
      ? `인건비 ${won(input.monthLabor)} / 당월 합계 ${won(input.monthTotal)} (${monthRatio}%). 발주처 규정 최대 한도(50%)를 넘었습니다. 발주처 승인 공문을 첨부하거나 사유를 적으세요.`
      : level === 'approval'
        ? `인건비 ${won(input.monthLabor)} / 당월 합계 ${won(input.monthTotal)} (${monthRatio}%). 발주처 규정(30%)을 넘어 발주처 승인이 필요합니다. 최대는 50%입니다.`
        : `인건비 ${won(input.monthLabor)} / 당월 합계 ${won(input.monthTotal)} (${monthRatio}%).`;
  const cumulativeMessage = cumulativeRatio == null
    ? ''
    : `인건비 누계 ${won(input.cumulativeLabor)} / 계상된 안전관리비 ${won(input.budget || 0)} (${cumulativeRatio}%).`;
  return { monthRatio, cumulativeRatio, level, monthMessage, cumulativeMessage };
}

export function hasLaborSubmitOverride(files: AmountFile[]): boolean {
  return files.some((f) => {
    if (f.evidence_kind !== 'owner_approval') return false;
    return Boolean(String(f.file_path || '').trim() || String(f.note || '').trim() || String(f.file_name || '').trim());
  });
}
