/**
 * Partner risk-assessment Excel import.
 * Official KR forms often put 표지/안내 on sheet 1 and the real table
 * several rows below a title block. sheet_to_json on SheetNames[0] then
 * returns [] → "데이터가 없습니다."
 */
import * as XLSX from "xlsx";

export const RISK_EXCEL_HEADER_HINTS = [
  "공정",
  "공종",
  "세부작업",
  "세부공종",
  "위험요인",
  "유해위험",
  "위험발생",
  "기존대책",
  "현재대책",
  "개선대책",
  "추가대책",
  "가능성",
  "중대성",
  "위험도",
  "법적근거",
  "process",
  "hazard",
  "likelihood",
];

export function scoreHeaderRow(cells: unknown[]): number {
  const text = cells.map((c) => String(c ?? "").trim()).join(" | ");
  if (!text) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const h of RISK_EXCEL_HEADER_HINTS) {
    if (text.includes(h) || lower.includes(h.toLowerCase())) score += 1;
  }
  return score;
}

export function matrixToRecords(
  matrix: unknown[][],
  headerRow: number,
): { headers: string[]; rows: Record<string, string>[] } {
  const rawHeaders = (matrix[headerRow] || []).map((h, i) => {
    const t = String(h ?? "").trim();
    return t || `열${i + 1}`;
  });
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h) => {
    const n = (seen.get(h) || 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h} (${n})`;
  });
  const rows: Record<string, string>[] = [];
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const line = matrix[r] || [];
    const values = headers.map((_, i) => String(line[i] ?? "").trim());
    if (values.every((v) => !v)) continue;
    if (scoreHeaderRow(line) >= 2) continue;
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => {
      obj[h] = String(line[i] ?? "");
    });
    rows.push(obj);
  }
  return { headers, rows };
}

export type ParsedRiskExcel = {
  rows: Record<string, string>[];
  headers: string[];
  sheetName: string;
  headerRow: number;
};

export function parseRiskAssessmentWorkbook(wb: XLSX.WorkBook): ParsedRiskExcel {
  if (!wb.SheetNames.length) {
    throw new Error("시트가 없는 파일입니다.");
  }

  let best: {
    headerScore: number;
    sheetName: string;
    headerRow: number;
    matrix: unknown[][];
  } | null = null;

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const matrix = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];
    if (!matrix.length) continue;
    let headerRow = 0;
    let headerScore = 0;
    for (let i = 0; i < Math.min(matrix.length, 40); i++) {
      const s = scoreHeaderRow(matrix[i] || []);
      if (s > headerScore) {
        headerScore = s;
        headerRow = i;
      }
    }
    if (!best || headerScore > best.headerScore) {
      best = { headerScore, sheetName, headerRow, matrix };
    }
  }

  if (!best || best.headerScore < 2) {
    const names = wb.SheetNames.join(", ");
    throw new Error(
      `표 헤더(공정·위험요인 등)를 찾지 못했습니다. 시트가 표지/안내인 경우가 많습니다. (시트: ${names})`,
    );
  }

  const { headers, rows } = matrixToRecords(best.matrix, best.headerRow);
  if (rows.length === 0) {
    throw new Error(`「${best.sheetName}」시트에서 데이터 행을 찾지 못했습니다.`);
  }
  return {
    rows,
    headers,
    sheetName: best.sheetName,
    headerRow: best.headerRow + 1,
  };
}

export function parseRiskAssessmentExcel(data: ArrayBuffer | Uint8Array): ParsedRiskExcel {
  const wb = XLSX.read(data, { type: "array", cellDates: true });
  return parseRiskAssessmentWorkbook(wb);
}

export async function parseRiskAssessmentExcelFile(file: File): Promise<ParsedRiskExcel> {
  const buf = await file.arrayBuffer();
  return parseRiskAssessmentExcel(buf);
}
