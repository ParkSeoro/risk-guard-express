// 산업안전보건법 기반 안전점검 체크리스트 템플릿
// 점검 유형 × 공종별 법적 필수 점검 항목 매핑

export type InspectionType =
  | 'pre_work'      // 작업 전 점검 (일일)
  | 'during_work'   // 작업 중 점검
  | 'weekly'        // 주간 점검
  | 'monthly'       // 월간 점검
  | 'special'       // 특별 점검 (고위험/사고후)
  | 'patrol';       // 순회 점검

export const INSPECTION_TYPE_LABELS: Record<InspectionType, string> = {
  pre_work: '작업 전 점검(일일)',
  during_work: '작업 중 점검',
  weekly: '주간 점검',
  monthly: '월간 점검',
  special: '특별 점검',
  patrol: '순회 점검',
};

export interface ChecklistItem {
  code: string;
  label: string;
  legal_basis: string;
}

// 공통 항목 (모든 공종)
const COMMON_ITEMS: Record<InspectionType, ChecklistItem[]> = {
  pre_work: [
    { code: 'PRE-001', label: '작업장 정리정돈 및 통로 확보', legal_basis: '산업안전보건기준에 관한 규칙 제3조' },
    { code: 'PRE-002', label: '근로자 개인보호구(안전모/안전화/안전대) 착용 확인', legal_basis: '산업안전보건기준에 관한 규칙 제32조' },
    { code: 'PRE-003', label: '작업 전 TBM 실시 및 위험요인 공유', legal_basis: '산업안전보건법 제29조' },
    { code: 'PRE-004', label: '작업허가서·작업계획서 비치 여부', legal_basis: '산업안전보건법 제38조' },
    { code: 'PRE-005', label: '근로자 건강상태 확인', legal_basis: '산업안전보건법 제129조' },
    { code: 'PRE-006', label: '기상 상태(강풍/강우/혹서/혹한) 확인', legal_basis: '산업안전보건기준에 관한 규칙 제37조' },
  ],
  during_work: [
    { code: 'DUR-001', label: '안전수칙 준수 여부', legal_basis: '산업안전보건법 제6조' },
    { code: 'DUR-002', label: '보호구 지속 착용 상태', legal_basis: '산업안전보건기준에 관한 규칙 제32조' },
    { code: 'DUR-003', label: '근로자 위험 행동 여부', legal_basis: '산업안전보건법 제6조' },
    { code: 'DUR-004', label: '관리감독자 현장 배치 및 지휘', legal_basis: '산업안전보건법 제16조' },
  ],
  weekly: [
    { code: 'WK-001', label: '안전시설(안전난간/덮개/방호장치) 점검', legal_basis: '산업안전보건기준에 관한 규칙 제13조' },
    { code: 'WK-002', label: '소화기 등 소방시설 비치 및 작동 확인', legal_basis: '산업안전보건기준에 관한 규칙 제232조' },
    { code: 'WK-003', label: '비상통로 및 대피로 확보', legal_basis: '산업안전보건기준에 관한 규칙 제17조' },
    { code: 'WK-004', label: '응급처치함 및 비상연락망 게시', legal_basis: '산업안전보건기준에 관한 규칙 제33조' },
    { code: 'WK-005', label: '주간 안전회의 실시', legal_basis: '산업안전보건법 제24조' },
  ],
  monthly: [
    { code: 'MO-001', label: '안전보건 교육 실시 기록 확인', legal_basis: '산업안전보건법 제29조' },
    { code: 'MO-002', label: '산업안전보건위원회 개최', legal_basis: '산업안전보건법 제24조' },
    { code: 'MO-003', label: '건설기계·전기시설 정기점검', legal_basis: '산업안전보건기준에 관한 규칙 제93조' },
    { code: 'MO-004', label: '산업안전보건관리비 사용 점검', legal_basis: '산업안전보건법 제72조' },
    { code: 'MO-005', label: '근로자 건강진단 이행 점검', legal_basis: '산업안전보건법 제129조' },
  ],
  special: [
    { code: 'SP-001', label: '고위험 작업 위험성평가 재실시', legal_basis: '산업안전보건법 제36조' },
    { code: 'SP-002', label: '특별안전보건교육 실시 여부', legal_basis: '산업안전보건법 제29조 제3항' },
    { code: 'SP-003', label: '관리감독자 직접 입회 확인', legal_basis: '산업안전보건법 제16조' },
    { code: 'SP-004', label: '비상대응 시나리오 점검', legal_basis: '산업안전보건법 제24조' },
  ],
  patrol: [
    { code: 'PT-001', label: '현장 전반 위험요인 발견', legal_basis: '산업안전보건법 제15조' },
    { code: 'PT-002', label: '근로자 안전수칙 준수 상태', legal_basis: '산업안전보건법 제6조' },
    { code: 'PT-003', label: '안전표지·경고표지 부착 상태', legal_basis: '산업안전보건법 제37조' },
    { code: 'PT-004', label: '협력업체 안전관리 이행 상태', legal_basis: '산업안전보건법 제63조' },
  ],
};

// 공종별 추가 항목
const PROCESS_SPECIFIC: Record<string, ChecklistItem[]> = {
  '굴착': [
    { code: 'EXC-001', label: '굴착면 기울기·붕괴방지 조치', legal_basis: '산업안전보건기준에 관한 규칙 제338조' },
    { code: 'EXC-002', label: '굴착기·중장비 작업반경 통제', legal_basis: '산업안전보건기준에 관한 규칙 제200조' },
    { code: 'EXC-003', label: '지하매설물 사전 확인', legal_basis: '산업안전보건기준에 관한 규칙 제340조' },
  ],
  '고소작업': [
    { code: 'HGT-001', label: '안전대 부착설비 및 착용 확인', legal_basis: '산업안전보건기준에 관한 규칙 제42조' },
    { code: 'HGT-002', label: '추락방지망 설치 상태', legal_basis: '산업안전보건기준에 관한 규칙 제42조' },
    { code: 'HGT-003', label: '작업발판 폭(40cm 이상) 및 난간 확인', legal_basis: '산업안전보건기준에 관한 규칙 제56조' },
  ],
  '양중': [
    { code: 'LFT-001', label: '크레인 정격하중·작업반경 준수', legal_basis: '산업안전보건기준에 관한 규칙 제146조' },
    { code: 'LFT-002', label: '신호수 배치 및 신호체계 확인', legal_basis: '산업안전보건기준에 관한 규칙 제146조' },
    { code: 'LFT-003', label: '와이어로프·줄걸이 용구 점검', legal_basis: '산업안전보건기준에 관한 규칙 제63조' },
  ],
  '용접': [
    { code: 'WLD-001', label: '화기작업 허가 및 화재감시자 배치', legal_basis: '산업안전보건기준에 관한 규칙 제241조' },
    { code: 'WLD-002', label: '소화기·방화포 비치', legal_basis: '산업안전보건기준에 관한 규칙 제232조' },
    { code: 'WLD-003', label: '환기 및 유해가스 측정', legal_basis: '산업안전보건기준에 관한 규칙 제422조' },
  ],
  '밀폐공간': [
    { code: 'CFD-001', label: '산소·유해가스 농도 측정', legal_basis: '산업안전보건기준에 관한 규칙 제619조' },
    { code: 'CFD-002', label: '환기설비 가동', legal_basis: '산업안전보건기준에 관한 규칙 제620조' },
    { code: 'CFD-003', label: '감시인 배치 및 비상연락 체계', legal_basis: '산업안전보건기준에 관한 규칙 제640조' },
  ],
  '전기': [
    { code: 'ELE-001', label: '누전차단기·접지 상태', legal_basis: '산업안전보건기준에 관한 규칙 제304조' },
    { code: 'ELE-002', label: '활선근접 작업 시 절연조치', legal_basis: '산업안전보건기준에 관한 규칙 제321조' },
    { code: 'ELE-003', label: '전기기계·기구 외함 손상 여부', legal_basis: '산업안전보건기준에 관한 규칙 제302조' },
  ],
};

export function buildChecklist(type: InspectionType, processCategory: string): ChecklistItem[] {
  const base = COMMON_ITEMS[type] || [];
  // process category may be free text; match by includes
  const extras: ChecklistItem[] = [];
  for (const [key, items] of Object.entries(PROCESS_SPECIFIC)) {
    if (processCategory && processCategory.includes(key)) {
      extras.push(...items);
    }
  }
  return [...base, ...extras];
}

export const PROCESS_CATEGORIES = Object.keys(PROCESS_SPECIFIC);
