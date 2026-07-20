/**
 * 허가서 그리드 셀 지정 규약 및 유틸.
 * grid_snapshot: GridBook (엑셀 원본 구조)
 * input_cells: 마스터가 지정한 입력/서명/체크/날짜 셀.
 */
import type { GridBook } from '@/lib/xlsxGrid';

export type InputCellKind = 'text' | 'check' | 'sign' | 'date';

export interface InputCell {
  sheet: number;       // 시트 인덱스
  row: number;         // 0-based
  col: number;         // 0-based
  field_key: string;   // form_data 저장 키
  kind: InputCellKind;
  role?: string;       // sign 전용: 결재라인 role (contractor_pic, sm, ...)
  label?: string;      // 관리용 라벨
}

export const KIND_COLOR: Record<InputCellKind, string> = {
  text: 'rgba(254, 240, 138, 0.65)',   // 연노랑
  check: 'rgba(187, 247, 208, 0.75)',  // 연녹
  sign: 'rgba(254, 215, 170, 0.75)',   // 연주황
  date: 'rgba(191, 219, 254, 0.7)',    // 연파랑
};

export const KIND_LABEL: Record<InputCellKind, string> = {
  text: '입력',
  check: '체크',
  sign: '서명',
  date: '날짜',
};

export const cellId = (c: Pick<InputCell, 'sheet' | 'row' | 'col'>) =>
  `${c.sheet}:${c.row}:${c.col}`;

export const findInputCell = (cells: InputCell[], sheet: number, row: number, col: number) =>
  cells.find((c) => c.sheet === sheet && c.row === row && c.col === col);

export const isEmptyGrid = (g: any): g is null =>
  !g || !Array.isArray(g?.sheets) || g.sheets.length === 0;

export const gridSheetCount = (g: GridBook | null) => (g?.sheets?.length || 0);
