import { describe, expect, it } from 'vitest';
import { hasLaborSubmitOverride, laborRatioStatus, listAmountNotices } from '@/lib/safetyCostAmountMatch';
import { encodeSafetyCostMoneyNote, parseSafetyCostMoneyNote } from '@/lib/safetyCostMoneyNote';

describe('safety cost amount match', () => {
  it('names a transaction total that does not match the line', () => {
    const notices = listAmountNotices(
      [{ id: 'a', item_name: '낙하물방지망', supplier_name: '홍익상사', amount: 792000, category_code: '2' }],
      [{
        id: 'f',
        item_id: 'a',
        evidence_kind: 'transaction',
        file_path: 'tx.pdf',
        note: encodeSafetyCostMoneyNote({ total: 750000 }),
      }],
    );
    expect(notices.some((n) => n.blocking && n.message.includes('낙하물방지망') && n.message.includes('거래명세서 부족'))).toBe(true);
  });

  it('asks for a statement total without blocking', () => {
    const notices = listAmountNotices(
      [{ id: 'a', item_name: '난간', amount: 1000, category_code: '2' }],
      [{ id: 'f', item_id: 'a', evidence_kind: 'transaction', file_name: '명세.jpg', note: '' }],
    );
    expect(notices).toEqual([{ blocking: false, fileId: 'f', message: '난간: 거래명세서 합계를 적어 주세요.' }]);
  });

  it('reads a money tag when part comes before total', () => {
    expect(parseSafetyCostMoneyNote('[[sc part=2000 total=5000]]배분')).toEqual({
      total: 5000,
      part: 2000,
      text: '배분',
    });
  });

  it('treats one won as the same amount', () => {
    const notices = listAmountNotices(
      [{ id: 'a', item_name: '난간', amount: 1000, supply_amount: 909, vat_amount: 91, category_code: '2' }],
      [],
    );
    expect(notices).toEqual([]);
  });

  it('flags labor over 50 percent and allows an approval file', () => {
    const over = laborRatioStatus({ monthLabor: 6000000, monthTotal: 10000000, cumulativeLabor: 6000000, budget: 100000000 });
    expect(over.level).toBe('over');
    expect(over.monthMessage).toContain('발주처 규정');
    expect(over.monthMessage).not.toContain('법 위반');
    const mid = laborRatioStatus({ monthLabor: 4200000, monthTotal: 10000000, cumulativeLabor: 4200000, budget: null });
    expect(mid.level).toBe('approval');
    expect(mid.cumulativeMessage).toBe('');
    expect(hasLaborSubmitOverride([{ evidence_kind: 'owner_approval', file_name: '승인.pdf', file_path: 'a.pdf' }])).toBe(true);
    expect(hasLaborSubmitOverride([])).toBe(false);
  });
});
