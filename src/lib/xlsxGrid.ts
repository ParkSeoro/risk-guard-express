/**
 * 엑셀(xlsx) → 그리드 모델 파서
 * - 병합, 컬럼 폭, 행 높이, 셀 텍스트를 보존해서 HTML 표로 렌더할 수 있도록 정규화한다.
 * - 커뮤니티 xlsx 라이브러리 한계로 서식(색/폰트)은 최소한만 유지.
 */
import * as XLSX from 'xlsx';

export interface GridCell {
  /** 표시 텍스트 */
  text: string;
  /** 원본 값 */
  value: string | number | boolean | null;
  /** 병합 마스터 여부. false면 rowspan/colspan에 흡수되어 렌더 시 건너뛴다. */
  hidden?: boolean;
  rowspan?: number;
  colspan?: number;
  align?: 'left' | 'center' | 'right';
  bold?: boolean;
  wrap?: boolean;
}

export interface GridSheet {
  name: string;
  rows: number;
  cols: number;
  /** cells[r][c] */
  cells: GridCell[][];
  /** 픽셀 근사 컬럼 폭 */
  colWidths: number[];
  /** 픽셀 근사 행 높이 */
  rowHeights: number[];
}

export interface GridBook {
  sheets: GridSheet[];
}

const DEFAULT_COL_W = 72;
const DEFAULT_ROW_H = 22;

/** xlsx의 컬럼 wch(문자 개수) → 픽셀 근사 */
const wchToPx = (wch?: number) => (wch ? Math.max(24, Math.round(wch * 7 + 8)) : DEFAULT_COL_W);
const pxOr = (hpx?: number, pt?: number) => hpx || (pt ? Math.round(pt * 1.333) : DEFAULT_ROW_H);

export function parseXlsxToGrid(input: ArrayBuffer | Uint8Array): GridBook {
  const wb = XLSX.read(input, { type: 'array', cellStyles: true, cellFormula: false });
  const sheets: GridSheet[] = wb.SheetNames.map((name) => {
    const ws = wb.Sheets[name];
    const ref = ws['!ref'] || 'A1';
    const range = XLSX.utils.decode_range(ref);
    const rows = range.e.r + 1;
    const cols = range.e.c + 1;

    const cells: GridCell[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ text: '', value: null } as GridCell)),
    );

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell: any = ws[addr];
        if (!cell) continue;
        const s: any = cell.s || {};
        const align = s.alignment?.horizontal;
        cells[r][c] = {
          text: cell.w != null ? String(cell.w) : cell.v != null ? String(cell.v) : '',
          value: cell.v ?? null,
          align: align === 'center' ? 'center' : align === 'right' ? 'right' : 'left',
          bold: !!s.font?.bold,
          wrap: !!s.alignment?.wrapText,
        };
      }
    }

    const merges = ws['!merges'] || [];
    merges.forEach((m) => {
      const master = cells[m.s.r]?.[m.s.c];
      if (!master) return;
      master.rowspan = m.e.r - m.s.r + 1;
      master.colspan = m.e.c - m.s.c + 1;
      for (let r = m.s.r; r <= m.e.r; r++) {
        for (let c = m.s.c; c <= m.e.c; c++) {
          if (r === m.s.r && c === m.s.c) continue;
          if (cells[r]?.[c]) cells[r][c].hidden = true;
        }
      }
    });

    const colInfo = ws['!cols'] || [];
    const colWidths = Array.from({ length: cols }, (_, i) => wchToPx(colInfo[i]?.wch));
    const rowInfo = ws['!rows'] || [];
    const rowHeights = Array.from({ length: rows }, (_, i) => pxOr(rowInfo[i]?.hpx, rowInfo[i]?.hpt));

    return { name, rows, cols, cells, colWidths, rowHeights };
  });
  return { sheets };
}
