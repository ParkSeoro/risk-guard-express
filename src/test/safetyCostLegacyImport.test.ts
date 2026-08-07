import { describe, expect, it } from 'vitest';
import {
  buildCommitPreview,
  normalizeLegacyDraft,
  parseLegacyTextDraft,
  validateLegacyDraft,
} from '@/lib/safetyCostLegacyImport';
import {
  aggregatePpeStock,
  canIssueFromStock,
  isPpeInboundItem,
  normalizePpeItemKey,
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
});
