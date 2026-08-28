import { describe, expect, it } from 'vitest';
import {
  buildCommitPreview,
  draftFromCategoryGrid,
  itemsFromCategoryAmounts,
  normalizeLegacyDraft,
  normalizeLegacyItem,
  parseLegacyTextDraft,
  planLegacyCommitMonths,
  suggestNextImportMonth,
  summarizeCategoryGrid,
  validateCategoryGrid,
  validateLegacyDraft,
} from '@/lib/safetyCostLegacyImport';
import {
  aggregatePpeStock,
  canIssueFromStock,
  isPpeInboundItem,
  normalizePpeItemKey,
  planPpeConfirm,
  planPpeIssue,
} from '@/lib/safetyCostPpeStock';

describe('safetyCostLegacyImport', () => {
  it('parses month and amount lines from text', () => {
    const draft = parseLegacyTextDraft(`
2026년 07월 사용내역 집계
안전모 흰 10개 150,000
안전화 250mm 5켤레 200,000
당월 합계 350,000
`);
    expect(draft.months.length).toBeGreaterThan(0);
    const m = draft.months[0];
    expect(m.report_month).toMatch(/^2026-07/);
    expect(m.items.length).toBeGreaterThanOrEqual(2);
    expect(m.items.some((i) => i.item_name.includes('안전모'))).toBe(true);
  });

  it('blocks commit when month total mismatches', () => {
    const draft = normalizeLegacyDraft({
      months: [{
        report_month: '2026-07',
        declared_total: 100000,
        included: true,
        items: [
          { item_name: '안전모', amount: 40000, category_code: '3', quantity: 2 },
          { item_name: '교육비', amount: 50000, category_code: '5', quantity: 1 },
        ],
      }],
    });
    const v = validateLegacyDraft(draft);
    expect(v.canCommit).toBe(false);
    expect(v.issues.some((i) => i.code === 'MONTH_TOTAL_MISMATCH')).toBe(true);
  });

  it('allows commit when totals match', () => {
    const draft = normalizeLegacyDraft({
      months: [{
        report_month: '2026-06',
        declared_total: 90000,
        included: true,
        items: [
          { item_name: '안전모', amount: 40000, category_code: '3', quantity: 4 },
          { item_name: '안전교육', amount: 50000, category_code: '5', quantity: 1 },
        ],
      }],
    });
    const v = validateLegacyDraft(draft, { safetyCostTotal: 1_000_000 });
    expect(v.canCommit).toBe(true);
    expect(buildCommitPreview(draft).totalAmount).toBe(90000);
    expect(buildCommitPreview(draft).ppeInboundCount).toBe(1);
  });

  it('flags over budget', () => {
    const draft = normalizeLegacyDraft({
      months: [{
        report_month: '2026-01',
        declared_total: 80,
        items: [{ item_name: '안전모', amount: 80, category_code: '3', quantity: 1 }],
      }],
    });
    const v = validateLegacyDraft(draft, { safetyCostTotal: 100, existingApprovedTotal: 50 });
    expect(v.issues.some((i) => i.code === 'OVER_BUDGET')).toBe(true);
  });

  it('rejects commit planner when a live month already exists', () => {
    const draft = normalizeLegacyDraft({
      months: [{
        report_month: '2026-07',
        declared_total: 100,
        items: [{ item_name: '안전모', amount: 100, category_code: '3', quantity: 1 }],
      }],
    });
    const plan = planLegacyCommitMonths(draft, [
      { report_month: '2026-07-01', status: 'submitted', is_deleted: false },
    ]);
    expect(plan.ok).toBe(false);
    expect(plan.plans[0].action).toBe('reject_live');
  });

  it('allows commit planner insert when the month is free', () => {
    const draft = normalizeLegacyDraft({
      months: [{
        report_month: '2026-08',
        declared_total: 100,
        items: [{ item_name: '안전모', amount: 100, category_code: '3', quantity: 1 }],
      }],
    });
    const plan = planLegacyCommitMonths(draft, [
      { report_month: '2026-07-01', status: 'approved', is_deleted: false },
    ]);
    expect(plan.ok).toBe(true);
    expect(plan.plans[0].action).toBe('insert');
  });

  it('keeps quantity 0 so 이관 총괄 3번은 재고 입고가 아니다', () => {
    const item = normalizeLegacyItem({
      item_name: '보호구 등 (이관 총괄)',
      amount: 100000,
      category_code: '3',
      quantity: 0,
    });
    expect(item?.quantity).toBe(0);
    expect(isPpeInboundItem(item!)).toBe(false);
  });
});

describe('safetyCost category grid import', () => {
  const jan = {
    report_month: '2026-01',
    amounts: { '1': 100000, '2': 0, '3': 50000, '4': 0, '5': 20000, '6': 0, '7': 0, '8': 0, '9': 0 },
    declared_total: 170000,
  };
  const feb = {
    report_month: '2026-02',
    amounts: { '1': 100000, '2': 30000, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0, '9': 0 },
    declared_total: 130000,
  };

  it('builds one usable row per positive 비목 and skips PPE inbound', () => {
    const items = itemsFromCategoryAmounts('2026-01', jan.amounts);
    expect(items.map((i) => i.category_code)).toEqual(['1', '3', '5']);
    expect(items.every((i) => i.quantity === 0)).toBe(true);
    expect(items.every((i) => i.classification_status === 'usable')).toBe(true);
    expect(items.every((i) => i.ocr_status === 'user_edited')).toBe(true);
    expect(items.filter((i) => i.category_code === '3').every((i) => !isPpeInboundItem(i))).toBe(true);
    expect(buildCommitPreview(draftFromCategoryGrid([jan])).ppeInboundCount).toBe(0);
    expect(buildCommitPreview(draftFromCategoryGrid([jan])).totalAmount).toBe(170000);
  });

  it('chains 비목 누계 across months', () => {
    const s = summarizeCategoryGrid([jan, feb]);
    expect(s.importTotal).toBe(300000);
    expect(s.afterCumulatives['1']).toBe(200000);
    expect(s.afterCumulatives['2']).toBe(30000);
    expect(s.afterCumulatives['3']).toBe(50000);
    expect(s.afterCumulatives['5']).toBe(20000);
    expect(s.monthRows[1].categoryCumulatives['1']).toBe(200000);
  });

  it('adds existing approved 비목 into the next-month 전월 누계', () => {
    const s = summarizeCategoryGrid([feb], { '1': 100000, '2': 0, '3': 50000, '4': 0, '5': 20000, '6': 0, '7': 0, '8': 0, '9': 0 });
    expect(s.afterCumulatives['1']).toBe(200000);
    expect(s.afterCumulatives['3']).toBe(50000);
    expect(s.importTotal).toBe(130000);
  });

  it('blocks when 비목 합 ≠ 문서 금월계', () => {
    const v = validateCategoryGrid([{ ...jan, declared_total: 999 }], { safetyCostTotal: 10_000_000 });
    expect(v.canCommit).toBe(false);
    expect(v.issues.some((i) => i.code === 'MONTH_TOTAL_MISMATCH')).toBe(true);
  });

  it('blocks duplicate months and live months', () => {
    const dup = validateCategoryGrid([jan, { ...jan, declared_total: 170000 }]);
    expect(dup.issues.some((i) => i.code === 'DUPLICATE_MONTH')).toBe(true);
    const live = validateCategoryGrid([jan], {
      safetyCostTotal: 10_000_000,
      liveReports: [{ report_month: '2026-01-01', status: 'draft' }],
    });
    expect(live.canCommit).toBe(false);
    expect(live.issues.some((i) => i.code === 'LIVE_MONTH')).toBe(true);
  });

  it('blocks over budget and 문서 최종 누계 mismatch', () => {
    const over = validateCategoryGrid([jan], { safetyCostTotal: 100000, existingApprovedTotal: 50000 });
    expect(over.issues.some((i) => i.code === 'OVER_BUDGET')).toBe(true);
    const cum = validateCategoryGrid([jan], { safetyCostTotal: 10_000_000, declaredCumulative: 1 });
    expect(cum.issues.some((i) => i.code === 'CUMULATIVE_MISMATCH')).toBe(true);
    const ok = validateCategoryGrid([jan, feb], { safetyCostTotal: 10_000_000, declaredCumulative: 300000 });
    expect(ok.canCommit).toBe(true);
  });

  it('suggests the next free month after grid rows', () => {
    expect(suggestNextImportMonth(['2026-01'], ['2026-02'])).toBe('2026-03');
  });
});

describe('safetyCostPpeStock', () => {
  it('normalizes sku keys', () => {
    expect(normalizePpeItemKey({ item_name: '안전모', specification: '흰', maker: 'A' }))
      .toBe(normalizePpeItemKey({ item_name: ' 안전모 ', specification: '흰', maker: 'A' }));
  });

  it('aggregates in/out balance', () => {
    const bal = aggregatePpeStock(
      [{ id: 's1', item_key: 'a', item_name: '안전모', unit: '개' }],
      [
        { sku_id: 's1', movement_type: 'in', quantity: 10 },
        { sku_id: 's1', movement_type: 'out', quantity: 3 },
        { sku_id: 's1', movement_type: 'out', quantity: 2 },
      ],
    );
    expect(bal[0].balance).toBe(5);
    expect(canIssueFromStock(5, 6).ok).toBe(false);
    expect(canIssueFromStock(5, 2).ok).toBe(true);
  });

  it('detects ppe inbound items', () => {
    expect(isPpeInboundItem({ category_code: '3', quantity: 2, item_name: '안전모' })).toBe(true);
    expect(isPpeInboundItem({ category_code: '5', quantity: 2, item_name: '교육' })).toBe(false);
  });

  it('uses name+spec+maker for issuance keys', () => {
    expect(normalizePpeItemKey({ item_name: '안전모', specification: '백색', maker: 'A' }))
      .not.toBe(normalizePpeItemKey({ item_name: '안전모' }));
  });

  it('plans pending app issue vs signed manual issue', () => {
    const pending = planPpeIssue({ quantity: 2, stockBalance: 5 });
    expect(pending.receipt_status).toBe('pending');
    expect(pending.writesStockOut).toBe(false);
    const signed = planPpeIssue({ quantity: 2, stockBalance: 5, signatureData: 'data:image/png;base64,xx' });
    expect(signed.receipt_status).toBe('confirmed');
    expect(signed.writesStockOut).toBe(true);
    expect(planPpeIssue({ quantity: 6, stockBalance: 5 }).ok).toBe(false);
  });

  it('confirm is idempotent when already signed', () => {
    const again = planPpeConfirm({ receipt_status: 'confirmed', signature_data: 'data:xx', stock_movement_id: 'm1' });
    expect(again.alreadyConfirmed).toBe(true);
    expect(again.writesStockOut).toBe(false);
    const first = planPpeConfirm({ receipt_status: 'pending', signature_data: '' });
    expect(first.writesStockOut).toBe(true);
  });
});
