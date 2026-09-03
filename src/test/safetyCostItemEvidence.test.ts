import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { evaluateEvidencePack, packGateSummary } from '@/lib/safetyCostEvidencePack';
import {
  cloneEvidenceToCategories,
  countCategoryKind,
  countItemKind,
  itemDailyChecklist,
  itemMissingDailyHard,
  itemTransactionEvidenceRows,
  missingAllocationNotes,
  monthEndTaxLabel,
  reconcileCategoryTotals,
} from '@/lib/safetyCostItemEvidence';
import { SAFETY_COST_CATEGORY_SHORT } from '@/lib/safetyCost';

describe('safetyCostItemEvidence', () => {
  it('uses 임금 as the short name for category 1', () => {
    expect(SAFETY_COST_CATEGORY_SHORT['1']).toBe('임금');
  });

  it('wires analysis results onto item cards instead of staying on the AI tab', () => {
    const src = readFileSync('src/pages/SafetyCost.tsx', 'utf8');
    expect(src).toContain('itemTransactionEvidenceRows');
    expect(src).toContain("setReportTab('items')");
    expect(src).toContain('SafetyCostItemCards');
    expect(src).toContain('sourceTransaction');
  });

  it('clones one statement file onto each extracted line', () => {
    const rows = itemTransactionEvidenceRows(
      {
        report_id: 'r1',
        construction_id: 'c1',
        project_id: 'p1',
        company_id: 'co1',
        file_name: 'spec.jpg',
        file_path: 'safety-cost/p/r/spec.jpg',
        file_url: 'https://example/spec.jpg',
        mime_type: 'image/jpeg',
        file_size: 12,
        uploaded_by: 'u1',
      },
      [
        { id: 'i1', category_code: '3' },
        { id: 'i2', category_code: '2' },
      ],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.evidence_kind === 'transaction' && r.file_path.endsWith('spec.jpg'))).toBe(true);
    expect(rows[0].item_id).toBe('i1');
    expect(rows[0].category_code).toBe('3');
    expect(rows[1].category_code).toBe('2');
  });

  it('counts multiple transaction files on one line', () => {
    const files = [
      { item_id: 'a', evidence_kind: 'transaction', category_code: '3' },
      { item_id: 'a', evidence_kind: 'transaction', category_code: '3' },
    ];
    expect(countItemKind(files, 'a', 'transaction')).toBe(2);
    expect(evaluateEvidencePack({
      items: [{ id: 'a', category_code: '3', amount: 100000 }],
      files: [
        ...files,
        { item_id: 'a', evidence_kind: 'site_photo', category_code: '3' },
        { item_id: null, evidence_kind: 'tax_invoice', category_code: '3' },
      ],
      ppeLedgerSignedCount: 1,
    }).rows.find((r) => r.requirement.kind === 'transaction')?.ok).toBe(true);
  });

  it('does not count a report-only statement without category or item', () => {
    const result = evaluateEvidencePack({
      items: [{ id: 'a', category_code: '3', amount: 100000 }],
      files: [{ item_id: null, evidence_kind: 'transaction' }],
    });
    expect(result.rows.find((r) => r.requirement.kind === 'transaction')?.ok).toBe(false);
  });

  it('counts tax invoices per category, not per supplier', () => {
    const items = [
      { id: 'a', category_code: '3', amount: 50000, item_name: '안전모' },
      { id: 'b', category_code: '2', amount: 80000, item_name: '난간' },
    ];
    const files = [
      { item_id: null, evidence_kind: 'tax_invoice', category_code: '3' },
    ];
    expect(countCategoryKind(items, files, '3', 'tax_invoice')).toBe(1);
    expect(countCategoryKind(items, files, '2', 'tax_invoice')).toBe(0);
  });

  it('reconciles category total against statement-linked lines', () => {
    const items = [
      { id: 'a', category_code: '3', amount: 100000, classification_status: 'usable' },
      { id: 'b', category_code: '3', amount: 50000, classification_status: 'usable' },
    ];
    const mismatch = reconcileCategoryTotals(items, [
      { item_id: 'a', evidence_kind: 'transaction', category_code: '3' },
    ]);
    expect(mismatch[0].usableTotal).toBe(150000);
    expect(mismatch[0].statementLinkedTotal).toBe(100000);
    expect(mismatch[0].ok).toBe(false);

    const ok = reconcileCategoryTotals(items, [
      { item_id: 'a', evidence_kind: 'transaction', category_code: '3' },
      { item_id: 'b', evidence_kind: 'transaction', category_code: '3' },
    ]);
    expect(ok[0].ok).toBe(true);
    expect(ok[0].difference).toBe(0);
  });

  it('excludes warning lines from the pack gate and reconcile', () => {
    const result = evaluateEvidencePack({
      items: [
        { id: 'a', category_code: '3', amount: 100000, classification_status: 'warning' },
      ],
      files: [],
    });
    expect(result.rows).toEqual([]);
    expect(result.ready).toBe(true);
    expect(result.reconcile).toEqual([]);
  });

  it('blocks submit when statement totals do not match usable spend', () => {
    const result = evaluateEvidencePack({
      items: [{ id: 'a', category_code: '3', amount: 100000 }],
      files: [
        { item_id: 'a', evidence_kind: 'site_photo', category_code: '3' },
        { item_id: null, evidence_kind: 'tax_invoice', category_code: '3' },
      ],
      ppeLedgerSignedCount: 2,
    });
    expect(result.reconcile[0]?.ok).toBe(false);
    expect(result.ready).toBe(false);
  });

  it('marks month-end tax on the line checklist from the category file', () => {
    const item = { id: 'a', category_code: '3', amount: 100000 };
    const files = [{ item_id: 'a', evidence_kind: 'transaction', category_code: '3' }];
    const waiting = itemDailyChecklist(item, files, 0);
    expect(waiting.find((r) => r.kind === 'tax_invoice')?.timing).toBe('month_end');
    expect(waiting.find((r) => r.kind === 'tax_invoice')?.ok).toBe(false);
    expect(monthEndTaxLabel(false)).toBe('월말 · 이 비목 대기');
    expect(itemMissingDailyHard(item, files)).toBe(true);
    const withPhoto = itemDailyChecklist(item, [
      ...files,
      { item_id: 'a', evidence_kind: 'site_photo', category_code: '3' },
    ], 1);
    expect(withPhoto.find((r) => r.kind === 'site_photo')?.ok).toBe(true);
    expect(itemMissingDailyHard(item, [
      ...files,
      { item_id: 'a', evidence_kind: 'site_photo', category_code: '3' },
    ])).toBe(false);
  });

  it('lets one category tax invoice cover every line in that category, not other categories', () => {
    const items = [
      { id: 'a', category_code: '3', amount: 10000, supplier_name: '동일업체' },
      { id: 'b', category_code: '3', amount: 20000, supplier_name: '동일업체' },
      { id: 'c', category_code: '3', amount: 30000, supplier_name: '다른업체' },
      { id: 'd', category_code: '2', amount: 40000, supplier_name: '동일업체' },
    ];
    const files = [{ item_id: null, evidence_kind: 'tax_invoice', category_code: '3', note: '총액 중 보호구 80,000원' }];
    expect(countCategoryKind(items, files, '3', 'tax_invoice')).toBe(1);
    expect(countCategoryKind(items, files, '2', 'tax_invoice')).toBe(0);
    for (const it of items.filter((i) => i.category_code === '3')) {
      expect(itemDailyChecklist(it, files, 1).find((r) => r.kind === 'tax_invoice')?.ok).toBe(true);
    }
    expect(itemDailyChecklist(items[3], files, 0).find((r) => r.kind === 'tax_invoice')?.ok).toBe(false);
  });

  it('clones one tax invoice onto every selected category', () => {
    const rows = cloneEvidenceToCategories(
      {
        report_id: 'r1',
        construction_id: 'c1',
        project_id: 'p1',
        company_id: 'co1',
        file_name: 'tax.pdf',
        file_path: 'safety-cost/p/r/tax.pdf',
        file_url: 'https://example/tax.pdf',
        mime_type: 'application/pdf',
        file_size: 20,
        uploaded_by: 'u1',
        evidence_kind: 'tax_invoice',
      },
      [
        { category_code: '2', note: '총액 중 시설비 80,000원' },
        { category_code: '3', note: '총액 중 보호구 50,000원' },
        { category_code: '3', note: '중복' },
      ],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.file_path.endsWith('tax.pdf') && r.item_id === null && r.evidence_kind === 'tax_invoice')).toBe(true);
    expect(rows.find((r) => r.category_code === '2')?.note).toBe('총액 중 시설비 80,000원');
    expect(rows.map((r) => r.category_code).sort()).toEqual(['2', '3']);

    const items = [
      { id: 'a', category_code: '2', amount: 80000 },
      { id: 'b', category_code: '3', amount: 50000 },
    ];
    expect(countCategoryKind(items, rows, '2', 'tax_invoice')).toBe(1);
    expect(countCategoryKind(items, rows, '3', 'tax_invoice')).toBe(1);
    const pack = evaluateEvidencePack({
      items,
      files: [
        ...rows,
        { item_id: 'a', evidence_kind: 'transaction', category_code: '2' },
        { item_id: 'a', evidence_kind: 'site_photo', category_code: '2' },
        { item_id: 'b', evidence_kind: 'transaction', category_code: '3' },
        { item_id: 'b', evidence_kind: 'site_photo', category_code: '3' },
      ],
      ppeLedgerSignedCount: 1,
    });
    expect(pack.rows.filter((r) => r.requirement.kind === 'tax_invoice').every((r) => r.ok)).toBe(true);
  });

  it('labels a reconcile-only pack failure without saying 필수 0건', () => {
    const pack = evaluateEvidencePack({
      items: [{ id: 'a', category_code: '3', amount: 100000 }],
      files: [
        { item_id: 'a', evidence_kind: 'site_photo', category_code: '3' },
        { item_id: null, evidence_kind: 'tax_invoice', category_code: '3' },
      ],
      ppeLedgerSignedCount: 2,
    });
    const summary = packGateSummary(pack);
    expect(pack.ready).toBe(false);
    expect(summary.label).toContain('대사');
    expect(summary.issueCount).toBeGreaterThan(0);
  });

  it('requires a per-category allocation note on a shared tax invoice', () => {
    expect(missingAllocationNotes([
      { category_code: '2', note: '' },
      { category_code: '3', note: '총액 중 보호구 5만' },
    ]).map((a) => a.category_code)).toEqual(['2']);
    const items = [{ id: 'a', category_code: '3', amount: 50000 }];
    const fileOnly = [{ item_id: null, evidence_kind: 'tax_invoice', category_code: '3' }];
    expect(evaluateEvidencePack({
      items,
      files: [
        ...fileOnly,
        { item_id: 'a', evidence_kind: 'transaction', category_code: '3' },
        { item_id: 'a', evidence_kind: 'site_photo', category_code: '3' },
      ],
      ppeLedgerSignedCount: 1,
    }).rows.find((r) => r.requirement.kind === 'tax_invoice')?.ok).toBe(false);
    expect(monthEndTaxLabel(false, true)).toBe('월말 · 이 비목 배분 메모 필요');
  });
});
