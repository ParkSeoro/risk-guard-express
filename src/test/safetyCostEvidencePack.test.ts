import { describe, expect, it } from 'vitest';
import {
  CATEGORY_EVIDENCE_PACK,
  evaluateEvidencePack,
  sumByCategory,
} from '@/lib/safetyCostEvidencePack';

describe('safetyCostEvidencePack', () => {
  it('defines packs for categories 1-9', () => {
    expect(CATEGORY_EVIDENCE_PACK.map((p) => p.code)).toEqual(
      ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
    );
  });

  it('requires PPE ledger when category 3 has spend', () => {
    const result = evaluateEvidencePack({
      items: [{ id: 'a', category_code: '3', amount: 100000 }],
      files: [
        { item_id: 'a', evidence_kind: 'transaction' },
        { item_id: 'a', evidence_kind: 'tax_invoice', note: '총액 중 보호구 전액' },
        { item_id: 'a', evidence_kind: 'site_photo' },
      ],
      ppeLedgerSignedCount: 0,
    });
    expect(result.ready).toBe(false);
    expect(result.hardMissing.some((r) => r.requirement.kind === 'ppe_ledger')).toBe(true);
  });

  it('accepts system PPE ledger signatures', () => {
    const result = evaluateEvidencePack({
      items: [{ id: 'a', category_code: '3', amount: 100000 }],
      files: [
        { item_id: 'a', evidence_kind: 'transaction' },
        { item_id: 'a', evidence_kind: 'tax_invoice', note: '총액 중 보호구 전액' },
        { item_id: 'a', evidence_kind: 'site_photo' },
      ],
      ppeLedgerSignedCount: 2,
    });
    expect(result.hardMissing.some((r) => r.requirement.kind === 'ppe_ledger')).toBe(false);
    expect(result.ready).toBe(true);
  });

  it('exempts legacy import months from the evidence gate', () => {
    const result = evaluateEvidencePack({
      items: [
        { id: 'a', category_code: '1', amount: 4_166_670 },
        { id: 'b', category_code: '2', amount: 10_682_000 },
      ],
      files: [],
      ppeLedgerSignedCount: 0,
      exempt: true,
    });
    expect(result.ready).toBe(true);
    expect(result.exempt).toBe(true);
    expect(result.hardMissing).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it('still requires evidence when not exempt', () => {
    const result = evaluateEvidencePack({
      items: [{ id: 'a', category_code: '1', amount: 4_166_670 }],
      files: [],
    });
    expect(result.ready).toBe(false);
    expect(result.exempt).toBe(false);
    expect(result.hardMissing.length).toBeGreaterThan(0);
  });

  it('sums by category', () => {
    expect(sumByCategory([
      { id: '1', category_code: '2', amount: 100 },
      { id: '2', category_code: '2', amount: 50 },
      { id: '3', category_code: '5', amount: 20 },
    ])).toEqual({ '2': 150, '5': 20 });
  });

  it('ignores report-only statements without category when counting kinds', () => {
    const result = evaluateEvidencePack({
      items: [{ id: 'a', category_code: '3', amount: 100000 }],
      files: [{ item_id: null, evidence_kind: 'transaction' }],
    });
    expect(result.rows.find((r) => r.requirement.kind === 'transaction')?.count).toBe(0);
  });
});
