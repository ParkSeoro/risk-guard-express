import { describe, expect, it } from 'vitest';
import { CATEGORY_SHEET, buildSafetyCostWorkbook } from '@/lib/safetyCostExport';
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('safetyCostExport', () => {
  it('has sheet map for categories 1-9', () => {
    expect(Object.keys(CATEGORY_SHEET)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  it('fills summary and detail from template', () => {
    const buf = readFileSync(resolve(process.cwd(), 'public/templates/safety-cost-template.xlsx'));
    const wb = buildSafetyCostWorkbook(buf, {
      companyName: '테스트건설',
      constructionName: '여수공장 정비공사',
      constructionAmount: 1_000_000_000,
      safetyCostTotal: 30_000_000,
      reportMonth: '2026-03-01',
      writerName: '홍길동',
      approvedCumulativeBeforeMonth: 5_000_000,
      approvedByCategoryBefore: { '1': 0, '2': 2_000_000, '3': 3_000_000, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0, '9': 0 },
      items: [
        {
          category_code: '3',
          category_name: '보호구 등',
          item_name: '안전모',
          specification: 'ABS',
          quantity: 10,
          unit: '개',
          unit_price: 15000,
          supply_amount: 150000,
          vat_amount: 15000,
          amount: 165000,
          supplier_name: '안전상사',
          classification_status: 'usable',
          transaction_date: '2026-03-05',
        },
      ],
      statusLabel: { usable: '사용 가능' },
      getDisplayDate: (it) => String(it.transaction_date || ''),
    });

    expect(wb.SheetNames).toContain('1.총괄');
    expect(wb.SheetNames).toContain('2.항목별');
    expect(wb.SheetNames).toContain('3.보호구');

    const summary = wb.Sheets['1.총괄'];
    expect(XLSX.utils.sheet_to_json(summary, { header: 1 })[3]).toBeTruthy();
    const detail = XLSX.utils.sheet_to_json(wb.Sheets['2.항목별'], { header: 1 }) as any[][];
    const dataRow = detail.find((r) => r?.[4] === '안전모');
    expect(dataRow).toBeTruthy();
    expect(dataRow?.[12]).toBe(165000);
  });

  it('does not add unapproved current month into cumulative column', () => {
    const buf = readFileSync(resolve(process.cwd(), 'public/templates/safety-cost-template.xlsx'));
    const input = {
      companyName: '테스트건설',
      constructionName: '여수공장 정비공사',
      constructionAmount: 1_000_000_000,
      safetyCostTotal: 30_000_000,
      reportMonth: '2026-03-01',
      writerName: '홍길동',
      approvedCumulativeBeforeMonth: 5_000_000,
      approvedByCategoryBefore: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0, '6': 0, '7': 0, '8': 0, '9': 0 },
      items: [
        { category_code: '3', amount: 165000, item_name: '안전모', classification_status: 'usable' },
      ],
      statusLabel: { usable: '사용 가능' },
      getDisplayDate: () => '2026-03-05',
    };
    const pending = buildSafetyCostWorkbook(buf, input);
    const approved = buildSafetyCostWorkbook(buf, { ...input, currentMonthApproved: true });
    expect(pending.Sheets['1.총괄']['C15']?.v).toBe(5_000_000);
    expect(pending.Sheets['1.총괄']['D15']?.v).toBe(165000);
    expect(pending.Sheets['1.총괄']['E15']?.v).toBe(5_000_000);
    expect(approved.Sheets['1.총괄']['E15']?.v).toBe(5_165_000);
  });
});
