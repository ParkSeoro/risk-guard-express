import * as XLSX from 'xlsx';
import { SAFETY_COST_CATEGORIES } from '@/lib/safetyCost';

export const SAFETY_COST_TEMPLATE_PATH = '/templates/safety-cost-template.xlsx';

/** Short sheet names in the official-style workbook */
export const CATEGORY_SHEET: Record<string, string> = {
  '1': '1.인건비',
  '2': '2.시설비',
  '3': '3.보호구',
  '4': '4.진단비',
  '5': '5.교육비',
  '6': '6.건강예방',
  '7': '7.기술지도',
  '8': '8.본사조직',
  '9': '9.위험성평가',
};

export type SafetyCostExportItem = {
  category_code?: string | null;
  category_name?: string | null;
  item_name?: string | null;
  specification?: string | null;
  maker?: string | null;
  quantity?: number | string | null;
  unit?: string | null;
  unit_price?: number | string | null;
  supply_amount?: number | string | null;
  vat_amount?: number | string | null;
  amount?: number | string | null;
  supplier_name?: string | null;
  classification_status?: string | null;
  transaction_date?: string | null;
  usage_date?: string | null;
  ai_reason?: string | null;
};

export type SafetyCostExportInput = {
  companyName: string;
  constructionName: string;
  constructionAmount: number;
  safetyCostTotal: number;
  reportMonth: string; // YYYY-MM or date
  writerName: string;
  approvedCumulativeBeforeMonth: number;
  approvedByCategoryBefore: Record<string, number>;
  items: SafetyCostExportItem[];
  statusLabel: Record<string, string>;
  getDisplayDate: (item: SafetyCostExportItem) => string;
};

function n(v: unknown) {
  const x = Number(v || 0);
  return Number.isFinite(x) ? x : 0;
}

function setCell(sheet: XLSX.WorkSheet, addr: string, value: string | number) {
  XLSX.utils.sheet_add_aoa(sheet, [[value]], { origin: addr });
}

export function buildSafetyCostWorkbook(
  templateBuf: ArrayBuffer | Uint8Array | Buffer,
  input: SafetyCostExportInput,
) {
  const bytes = templateBuf instanceof ArrayBuffer
    ? new Uint8Array(templateBuf)
    : templateBuf;
  const wb = XLSX.read(bytes, { type: 'array', cellStyles: true });
  const monthLabel = String(input.reportMonth).slice(0, 7);
  const remain = Math.max(0, n(input.safetyCostTotal) - (n(input.approvedCumulativeBeforeMonth) + input.items.reduce((s, it) => s + n(it.amount), 0)));
  // 누계집행율: 승인누계(전월) + 금월 항목 / 계상액 — 금월이 미승인이어도 작성 시점 기준으로 표기
  const monthTotal = input.items.reduce((s, it) => s + n(it.amount), 0);
  const cumulAll = n(input.approvedCumulativeBeforeMonth) + monthTotal;
  const execRate = n(input.safetyCostTotal) > 0
    ? Math.round((cumulAll / n(input.safetyCostTotal)) * 1000) / 10
    : 0;

  const byCatMonth: Record<string, number> = {};
  SAFETY_COST_CATEGORIES.forEach((c) => { byCatMonth[c.code] = 0; });
  input.items.forEach((it) => {
    const code = String(it.category_code || '');
    if (byCatMonth[code] != null) byCatMonth[code] += n(it.amount);
    else {
      const hit = SAFETY_COST_CATEGORIES.find((c) => c.name === it.category_name);
      if (hit) byCatMonth[hit.code] += n(it.amount);
    }
  });

  const summary = wb.Sheets['1.총괄'];
  if (summary) {
    setCell(summary, 'B4', input.companyName);
    setCell(summary, 'B6', input.constructionName);
    setCell(summary, 'B8', n(input.constructionAmount));
    setCell(summary, 'B9', n(input.safetyCostTotal));
    setCell(summary, 'B10', remain);
    setCell(summary, 'E10', execRate);
    setCell(summary, 'B11', monthLabel);
    setCell(summary, 'E11', input.writerName);

    // 계 row
    setCell(summary, 'B15', n(input.safetyCostTotal));
    setCell(summary, 'C15', n(input.approvedCumulativeBeforeMonth));
    setCell(summary, 'D15', monthTotal);
    setCell(summary, 'E15', cumulAll);
    setCell(summary, 'F15', execRate);

    SAFETY_COST_CATEGORIES.forEach((cat, idx) => {
      const r = 16 + idx;
      const prev = n(input.approvedByCategoryBefore[cat.code]);
      const cur = n(byCatMonth[cat.code]);
      const cum = prev + cur;
      const rate = n(input.safetyCostTotal) > 0 ? Math.round((cum / n(input.safetyCostTotal)) * 1000) / 10 : 0;
      setCell(summary, `C${r}`, prev);
      setCell(summary, `D${r}`, cur);
      setCell(summary, `E${r}`, cum);
      setCell(summary, `F${r}`, rate);
    });
  }

  const detail = wb.Sheets['2.항목별'];
  if (detail) {
    const sorted = [...input.items].sort((a, b) =>
      String(input.getDisplayDate(a)).localeCompare(String(input.getDisplayDate(b))),
    );
    const rows = sorted.map((it, idx) => [
      it.category_code || '',
      idx + 1,
      input.getDisplayDate(it),
      it.supplier_name || '',
      it.item_name || '',
      it.specification || '',
      it.maker || '',
      n(it.quantity) || 1,
      it.unit || '식',
      n(it.unit_price),
      n(it.supply_amount || it.amount),
      n(it.vat_amount),
      n(it.amount),
      input.statusLabel[it.classification_status || ''] || it.classification_status || '',
      '',
    ]);
    if (rows.length) XLSX.utils.sheet_add_aoa(detail, rows, { origin: 'A5' });
  }

  // 증빙체크 시트 — TOC 안내 (정적 템플릿 위에 작성 월·작성자 기입)
  const evidenceSheet = wb.Sheets['증빙체크'];
  if (evidenceSheet) {
    setCell(evidenceSheet, 'A14', `작성월: ${monthLabel} / 작성자: ${input.writerName}`);
    setCell(evidenceSheet, 'A21', '철 순서: 총괄 → 월별집계 → 업체별집계 → 증빙목록 → 항목별+증빙(1~9) → 보호구 지급대장');
  }

  // Per-category sheets
  SAFETY_COST_CATEGORIES.forEach((cat) => {
    const sheetName = CATEGORY_SHEET[cat.code];
    const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
    if (!sheet) return;
    const prev = n(input.approvedByCategoryBefore[cat.code]);
    const cur = n(byCatMonth[cat.code]);
    setCell(sheet, 'B3', ''); // 계상액(계획) — 비목별 배분 없으면 공란
    setCell(sheet, 'D3', prev);
    setCell(sheet, 'F3', cur);
    setCell(sheet, 'H3', prev + cur);

    const catItems = input.items
      .filter((it) => it.category_code === cat.code || it.category_name === cat.name)
      .sort((a, b) => String(input.getDisplayDate(a)).localeCompare(String(input.getDisplayDate(b))));

    // Generic row shape used across sheets (maps into first columns)
    const rows = catItems.map((it) => {
      if (cat.code === '1' || cat.code === '8') {
        return ['', '', it.item_name || '', '', n(it.amount), input.getDisplayDate(it), it.specification || it.ai_reason || '', it.supplier_name || ''];
      }
      return [
        input.getDisplayDate(it),
        it.item_name || '',
        it.specification || '',
        n(it.quantity) || 1,
        it.unit || '식',
        n(it.unit_price),
        n(it.amount),
        it.supplier_name || '',
        it.maker || '',
        '',
      ];
    });
    if (rows.length) XLSX.utils.sheet_add_aoa(sheet, rows, { origin: 'A6' });
  });

  return wb;
}

export function downloadSafetyCostWorkbook(wb: XLSX.WorkBook, fileName: string) {
  XLSX.writeFile(wb, fileName);
}
