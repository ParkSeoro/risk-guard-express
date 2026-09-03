/**
 * 안관비 줄 단위 매일 증빙 vs 비목 월말 세금계산서·대사.
 * 세금계산서는 납품업체가 아니라 비목(1~9)에 붙인다.
 */
import {
  EVIDENCE_KIND_LABEL,
  getCategoryPack,
  isPackEligibleItem,
  itemHasEvidenceKind,
  reconcileCategoryTotals,
  type CategoryPack,
  type EvidenceFileLike,
  type EvidenceKind,
  type ItemLike,
  type PackRequirement,
} from '@/lib/safetyCostEvidencePack';

export type PackEligibleItem = ItemLike;

export { isPackEligibleItem, reconcileCategoryTotals, itemHasEvidenceKind, EVIDENCE_KIND_LABEL };

export const MONTH_END_EVIDENCE_KINDS: ReadonlySet<string> = new Set(['tax_invoice']);

/** 품목 줄에 매일 붙이는 종류 (비목 철 전체가 아님) */
export const LINE_DAILY_EVIDENCE_KINDS: ReadonlySet<string> = new Set([
  'transaction',
  'site_photo',
  'certificate',
]);

export function isMonthEndEvidenceKind(kind?: string | null): boolean {
  return MONTH_END_EVIDENCE_KINDS.has(String(kind || ''));
}

export function lineDailyHardRequirements(pack: CategoryPack | null): PackRequirement[] {
  if (!pack) return [];
  return pack.requirements.filter((r) => r.hard && LINE_DAILY_EVIDENCE_KINDS.has(r.kind));
}

export function filesForItem(files: EvidenceFileLike[], itemId: string) {
  return (files || []).filter((f) => f.item_id === itemId);
}

export function countItemKind(files: EvidenceFileLike[], itemId: string, kind: string) {
  return filesForItem(files, itemId).filter((f) => String(f.evidence_kind || '') === kind).length;
}

export function itemHasKind(files: EvidenceFileLike[], itemId: string, kind: string) {
  return itemHasEvidenceKind(files, itemId, kind);
}

export function resolvedFileCategory(
  file: EvidenceFileLike,
  itemCat: Map<string, string>,
): string {
  const own = String(file.category_code || '');
  if (own) return own;
  if (file.item_id) return itemCat.get(file.item_id) || '';
  return '';
}

/** 비목 세금계산서: 그 비목 파일만 (업체 공유 없음). 줄에 붙인 것도 그 비목으로 센다. */
export function countCategoryKind(
  items: ItemLike[],
  files: EvidenceFileLike[],
  categoryCode: string,
  kind: string,
) {
  const itemCat = new Map(items.map((i) => [i.id, String(i.category_code || '')]));
  let n = 0;
  for (const f of files || []) {
    if (String(f.evidence_kind || '') !== kind) continue;
    if (resolvedFileCategory(f, itemCat) === String(categoryCode)) n += 1;
  }
  return n;
}

export type DailyCheckRow = {
  kind: EvidenceKind;
  label: string;
  count: number;
  ok: boolean;
  timing: 'daily' | 'month_end';
};

export function itemDailyChecklist(
  item: PackEligibleItem,
  files: EvidenceFileLike[],
  categoryTaxCount: number,
  taxNoted?: boolean,
): DailyCheckRow[] {
  const pack = getCategoryPack(item.category_code);
  if (!pack) return [];
  const noted = taxNoted ?? categoryTaxAllocationNotes([item], files, String(item.category_code || '')).length > 0;
  const rows: DailyCheckRow[] = [];
  for (const req of pack.requirements) {
    if (isMonthEndEvidenceKind(req.kind)) {
      rows.push({
        kind: req.kind,
        label: req.label,
        count: categoryTaxCount,
        ok: noted,
        timing: 'month_end',
      });
      continue;
    }
    if (!req.hard || !LINE_DAILY_EVIDENCE_KINDS.has(req.kind)) continue;
    const count = countItemKind(files, item.id, req.kind);
    rows.push({
      kind: req.kind,
      label: req.label,
      count,
      ok: count > 0,
      timing: 'daily',
    });
  }
  return rows;
}

export function itemMissingDailyHard(item: PackEligibleItem, files: EvidenceFileLike[]): boolean {
  if (!isPackEligibleItem(item)) return false;
  const pack = getCategoryPack(item.category_code);
  return lineDailyHardRequirements(pack).some((req) => !itemHasKind(files, item.id, req.kind));
}

export type SourceTransactionFile = {
  report_id: string;
  construction_id: string;
  project_id: string;
  company_id: string;
  file_name: string;
  file_path: string;
  file_url: string;
  mime_type: string;
  file_size: number;
  uploaded_by: string;
};

/** 같은 명세 파일을 뽑힌 줄마다 연결(물리 파일 1개, 행은 N개). */
export function itemTransactionEvidenceRows(
  source: SourceTransactionFile,
  items: Array<{ id: string; category_code?: string | null }>,
) {
  return items.map((it) => ({
    report_id: source.report_id,
    construction_id: source.construction_id,
    project_id: source.project_id,
    company_id: source.company_id,
    item_id: it.id,
    category_code: String(it.category_code || ''),
    evidence_kind: 'transaction' as const,
    file_name: source.file_name,
    file_path: source.file_path,
    file_url: source.file_url,
    mime_type: source.mime_type,
    file_size: source.file_size,
    uploaded_by: source.uploaded_by,
  }));
}

export type SourceCategoryEvidenceFile = SourceTransactionFile & {
  evidence_kind?: EvidenceKind;
};

/**
 * 세금계산서 한 장을 여러 비목에 연결(물리 파일 1개, 행은 비목마다 1개).
 * 일괄 발행 계산서에 1번 총액·2번 총액이 같이 있을 때 사용.
 */
export type CategoryAllocation = { category_code: string; note?: string };

export function evidenceNote(file?: { note?: string | null } | null) {
  return String(file?.note || '').trim();
}

export function normalizeCategoryAllocations(
  input: Array<string | CategoryAllocation>,
): Array<{ category_code: string; note: string }> {
  const seen = new Set<string>();
  const out: Array<{ category_code: string; note: string }> = [];
  for (const entry of input) {
    const category_code = String(typeof entry === 'string' ? entry : entry.category_code || '');
    const note = typeof entry === 'string' ? '' : evidenceNote({ note: entry.note });
    if (!category_code || seen.has(category_code)) continue;
    seen.add(category_code);
    out.push({ category_code, note });
  }
  return out;
}

export function missingAllocationNotes(input: Array<string | CategoryAllocation>) {
  return normalizeCategoryAllocations(input).filter((a) => !a.note);
}

export function categoryTaxAllocationNotes(
  items: ItemLike[],
  files: EvidenceFileLike[],
  categoryCode: string,
) {
  const itemCat = new Map(items.map((i) => [i.id, String(i.category_code || '')]));
  return (files || [])
    .filter((f) => String(f.evidence_kind || '') === 'tax_invoice' && resolvedFileCategory(f, itemCat) === String(categoryCode))
    .map((f) => evidenceNote(f))
    .filter(Boolean);
}

export function cloneEvidenceToCategories(
  source: SourceCategoryEvidenceFile,
  categoryCodes: Array<string | CategoryAllocation>,
) {
  const kind = source.evidence_kind || 'tax_invoice';
  return normalizeCategoryAllocations(categoryCodes).map(({ category_code, note }) => ({
    report_id: source.report_id,
    construction_id: source.construction_id,
    project_id: source.project_id,
    company_id: source.company_id,
    item_id: null,
    category_code,
    evidence_kind: kind,
    note,
    file_name: source.file_name,
    file_path: source.file_path,
    file_url: source.file_url,
    mime_type: source.mime_type,
    file_size: source.file_size,
    uploaded_by: source.uploaded_by,
  }));
}

export function monthEndTaxLabel(ok: boolean, hasFile = ok) {
  if (ok) return '월말 · 이 비목 첨부됨';
  if (hasFile) return '월말 · 이 비목 배분 메모 필요';
  return '월말 · 이 비목 대기';
}
