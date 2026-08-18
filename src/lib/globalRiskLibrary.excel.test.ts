import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  GLOBAL_RISK_LIBRARY_EXCEL_COLUMNS,
  GLOBAL_RISK_LIBRARY_EXCEL_REQUIRED,
  buildGlobalRiskLibraryExcelTemplate,
  mapGlobalRiskLibraryExcelRows,
} from '@/lib/globalRiskLibrary';

describe('global risk library excel template', () => {
  it('lists 공종·세부작업·위험요인 as required', () => {
    expect(GLOBAL_RISK_LIBRARY_EXCEL_REQUIRED).toEqual(['공종', '세부작업', '위험요인']);
  });

  it('round-trips the template sample rows through the uploader parser', () => {
    const wb = buildGlobalRiskLibraryExcelTemplate();
    expect(wb.SheetNames).toEqual(['항목', '작성안내']);
    const sheet = wb.Sheets['항목'];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });
    const headers = GLOBAL_RISK_LIBRARY_EXCEL_COLUMNS.map((c) => c.header);
    const first = json[0];
    for (const h of headers) {
      expect(first).toHaveProperty(h);
    }
    const mapped = mapGlobalRiskLibraryExcelRows(json);
    expect(mapped.length).toBeGreaterThanOrEqual(2);
    expect(mapped[0]).toMatchObject({
      process: '전기공사',
      sub_task: '케이블 포설',
      hazard: '감전',
    });
    expect(mapped[0].ppe).toContain('절연장갑');
  });

  it('drops rows missing required cells', () => {
    expect(
      mapGlobalRiskLibraryExcelRows([{ 공종: '배관', 세부작업: '', 위험요인: '추락' }]),
    ).toEqual([]);
  });
});
