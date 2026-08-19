import * as XLSX from 'xlsx';

/** Excel template + parser SSOT. Header names must match mapGlobalRiskLibraryExcelRows. */
export const GLOBAL_RISK_LIBRARY_EXCEL_COLUMNS = [
  { header: '공종', required: true, hint: '필수. 예: 전기공사' },
  { header: '세부작업', required: true, hint: '필수. 예: 케이블 포설' },
  { header: '위험요인', required: true, hint: '필수. 예: 감전' },
  { header: '위험발생상황', required: false, hint: '언제·어떻게 발생하는지' },
  { header: '현재대책', required: false, hint: '현재 적용 중인 대책' },
  { header: '개선대책', required: false, hint: '추가 개선 대책' },
  { header: '작업단계', required: false, hint: '준비 / 본작업 / 마무리 / 이상시' },
  { header: '위험유형', required: false, hint: '추락, 감전, 화재·폭발 등' },
  { header: '장비', required: false, hint: '쉼표로 구분. 예: 고소작업대, 용접기' },
  { header: '환경', required: false, hint: '쉼표로 구분. 예: 밀폐공간, 야간' },
  { header: '가능성', required: false, hint: '상 / 중 / 하 (비우면 중)' },
  { header: '중대성', required: false, hint: '상 / 중 / 하 (비우면 중)' },
  { header: '위험도', required: false, hint: '상 / 중 / 하 (비우면 중)' },
  { header: 'PPE', required: false, hint: '쉼표로 구분. 예: 안전모, 절연장갑' },
  { header: '법적근거', required: false, hint: '쉼표로 구분' },
] as const;

export const GLOBAL_RISK_LIBRARY_EXCEL_REQUIRED = GLOBAL_RISK_LIBRARY_EXCEL_COLUMNS.filter(
  (c) => c.required,
).map((c) => c.header);

const EXCEL_SAMPLE_ROWS: string[][] = [
  [
    '전기공사',
    '케이블 포설',
    '감전',
    '활선 근접 작업 중 충전부 접촉',
    '절연 장갑 착용, 활선작업 표지',
    '전원 차단 후 검전·잠금',
    '본작업',
    '감전',
    '용접기',
    '옥외',
    '중',
    '상',
    '상',
    '절연장갑, 안전모',
    '산업안전보건기준에 관한 규칙 제301조',
  ],
  [
    '토목공사',
    '굴착면 정리',
    '붕괴·매몰',
    '굴착면 기울기 부족으로 토사 붕괴',
    '기울기 확보, 출입 금지',
    '계측 및 매일 굴착면 점검',
    '본작업',
    '붕괴·매몰',
    '굴삭기',
    '우천',
    '중',
    '상',
    '상',
    '안전모, 안전화',
    '',
  ],
];

function excelCell(r: Record<string, unknown>, ...keys: string[]): string {
  for (const k of keys) {
    const v = r[k];
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
}

function excelSplitList(v: unknown): string[] {
  return String(v ?? '')
    .split(/[,;\n|/]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

export type GlobalRiskLibraryExcelMapped = {
  process: string;
  sub_task: string;
  hazard: string;
  hazard_situation: string;
  existing_measure: string;
  improvement_measure: string;
  work_phase: string;
  hazard_type: string;
  likelihood_grade: string;
  severity_grade: string;
  risk_grade: string;
  ppe: string[];
  legal_basis: string[];
  equipment_keys: string[];
  condition_keys: string[];
};

export function mapGlobalRiskLibraryExcelRows(
  json: Record<string, unknown>[],
): GlobalRiskLibraryExcelMapped[] {
  return json
    .map((r) => ({
      process: excelCell(r, '공종', 'process', 'process_label'),
      sub_task: excelCell(r, '세부작업', 'sub_task'),
      hazard: excelCell(r, '위험요인', 'hazard'),
      hazard_situation: excelCell(r, '위험발생상황', 'hazard_situation'),
      existing_measure: excelCell(r, '현재대책', 'existing_measure'),
      improvement_measure: excelCell(r, '개선대책', 'improvement_measure'),
      work_phase: excelCell(r, '작업단계', 'work_phase'),
      hazard_type: excelCell(r, '위험유형', 'hazard_type'),
      likelihood_grade: excelCell(r, '가능성', 'likelihood_grade') || '중',
      severity_grade: excelCell(r, '중대성', 'severity_grade') || '중',
      risk_grade: excelCell(r, '위험도', 'risk_grade') || '중',
      ppe: excelSplitList(excelCell(r, 'PPE', 'ppe')),
      legal_basis: excelSplitList(excelCell(r, '법적근거', 'legal_basis')),
      equipment_keys: excelSplitList(excelCell(r, '장비', 'equipment')),
      condition_keys: excelSplitList(excelCell(r, '환경', 'condition')),
    }))
    .filter((r) => r.process && r.sub_task && r.hazard);
}

export const GLOBAL_RISK_LIBRARY_EXCEL_TEMPLATE_FILENAME = '전역_위험성평가_라이브러리_양식.xlsx';

export function buildGlobalRiskLibraryExcelTemplate(): XLSX.WorkBook {
  const headers = GLOBAL_RISK_LIBRARY_EXCEL_COLUMNS.map((c) => c.header);
  const dataSheet = XLSX.utils.aoa_to_sheet([headers, ...EXCEL_SAMPLE_ROWS]);
  dataSheet['!cols'] = GLOBAL_RISK_LIBRARY_EXCEL_COLUMNS.map((c) => ({
    wch: Math.max(12, c.header.length * 2 + 4),
  }));
  const guide = XLSX.utils.aoa_to_sheet([
    ['전역 위험성평가 라이브러리 — 엑셀 양식 안내'],
    [],
    ['1. 「항목」시트 1행 헤더는 지우지 마세요. 컬럼 순서는 바꿔도 헤더 이름만 맞으면 됩니다.'],
    [`2. 필수 컬럼: ${GLOBAL_RISK_LIBRARY_EXCEL_REQUIRED.join(', ')}`],
    ['3. 샘플 2행은 지우고 실제 데이터로 채우세요. 한 줄 = 위험요인 1건.'],
    ['4. 장비·환경·PPE·법적근거는 쉼표(,)로 여러 개 입력할 수 있습니다.'],
    ['5. 가능성/중대성/위험도는 상·중·하. 비우면 중으로 저장됩니다.'],
    ['6. 저장한 파일을 화면의 「엑셀 업로드」로 올리면 바로 라이브러리에 반영됩니다.'],
    [],
    ['컬럼', '필수', '설명'],
    ...GLOBAL_RISK_LIBRARY_EXCEL_COLUMNS.map((c) => [c.header, c.required ? '필수' : '선택', c.hint]),
  ]);
  guide['!cols'] = [{ wch: 18 }, { wch: 8 }, { wch: 48 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, dataSheet, '항목');
  XLSX.utils.book_append_sheet(wb, guide, '작성안내');
  return wb;
}

export function downloadGlobalRiskLibraryExcelTemplate() {
  XLSX.writeFile(buildGlobalRiskLibraryExcelTemplate(), GLOBAL_RISK_LIBRARY_EXCEL_TEMPLATE_FILENAME);
}
