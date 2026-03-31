// 법정 작업계획서 대상 공종 및 템플릿 정의
// 산업안전보건법, 산업안전보건기준에 관한 규칙, KOSHA GUIDE 기준

export interface WorkPlanType {
  id: string;
  name: string;
  legalBasis: string;
  description: string;
  hasRiggingPlan: boolean;
  templateSections: TemplateSection[];
  requiredAttachments: string[];
}

export interface TemplateSection {
  key: string;
  title: string;
  type: 'text' | 'table' | 'checklist' | 'rigging';
  placeholder: string;
  aiPrompt?: string;
}

export const WORK_PLAN_TYPES: WorkPlanType[] = [
  {
    id: 'heavy_lifting',
    name: '중량물 취급 작업 (크레인 등)',
    legalBasis: '산업안전보건기준에 관한 규칙 제38조, 제132조~제175조',
    description: '크레인, 리프트, 곤돌라 등을 이용한 중량물 양중 작업',
    hasRiggingPlan: true,
    templateSections: [
      { key: 'overview', title: '작업 개요', type: 'text', placeholder: '작업명, 작업일시, 작업위치, 작업내용을 기재하세요.' },
      { key: 'equipment', title: '장비 정보', type: 'table', placeholder: '장비명, 규격, 정격하중, 검사일자 등' },
      { key: 'method', title: '작업 방법 및 절차', type: 'text', placeholder: '작업 순서, 신호수 배치, 안전조치 등을 기재하세요.', aiPrompt: '크레인을 이용한 중량물 양중 작업의 세부 작업절차와 안전조치를 작성해주세요.' },
      { key: 'risk', title: '위험요인 및 안전대책', type: 'text', placeholder: '전도, 협착, 낙하 등 위험요인과 대책', aiPrompt: '크레인 양중작업 시 발생 가능한 위험요인과 안전대책을 작성해주세요.' },
      { key: 'rigging', title: '리깅플랜', type: 'rigging', placeholder: '하중계산, 장비선정, 인양방식 등' },
      { key: 'signal', title: '신호체계', type: 'text', placeholder: '신호수 배치, 신호방법, 무전기 채널 등' },
      { key: 'emergency', title: '비상시 조치계획', type: 'text', placeholder: '사고 발생 시 대응절차' },
    ],
    requiredAttachments: [
      '크레인 제원표',
      '작업 반경도',
      '지반 지지력 검토서',
      '와이어/슬링 점검표',
      '양중계획도',
      '신호수 자격증 사본',
    ],
  },
  {
    id: 'excavation',
    name: '굴착 작업',
    legalBasis: '산업안전보건기준에 관한 규칙 제338조~제364조',
    description: '지반 굴착, 터파기, 절토 등의 작업',
    hasRiggingPlan: false,
    templateSections: [
      { key: 'overview', title: '작업 개요', type: 'text', placeholder: '굴착 위치, 깊이, 규모, 지반 종류 등' },
      { key: 'geology', title: '지반조사 결과', type: 'text', placeholder: '지질조사보고서 요약, 지하수위, 토질 등' },
      { key: 'method', title: '굴착 방법 및 절차', type: 'text', placeholder: '굴착순서, 장비, 사면기울기 등', aiPrompt: '굴착 작업의 세부 절차와 안전조치를 작성해주세요.' },
      { key: 'shoring', title: '흙막이 공법', type: 'text', placeholder: '흙막이 종류, 설치방법, 계측계획 등' },
      { key: 'risk', title: '위험요인 및 안전대책', type: 'text', placeholder: '붕괴, 매몰, 침수 등 위험요인과 대책', aiPrompt: '굴착작업 시 발생 가능한 위험요인과 안전대책을 작성해주세요.' },
      { key: 'emergency', title: '비상시 조치계획', type: 'text', placeholder: '붕괴, 침수 시 대피 및 구조절차' },
    ],
    requiredAttachments: [
      '지반조사보고서',
      '굴착계획도',
      '흙막이 구조계산서',
      '계측계획서',
      '지하매설물 확인서',
    ],
  },
  {
    id: 'tunnel',
    name: '터널 및 지하 작업 (쉴드공법 포함)',
    legalBasis: '산업안전보건기준에 관한 규칙 제365조~제389조, KOSHA GUIDE C-49',
    description: 'NATM, TBM, Semi Shield 등 터널 굴진 작업',
    hasRiggingPlan: false,
    templateSections: [
      { key: 'overview', title: '작업 개요', type: 'text', placeholder: '터널 연장, 단면, 공법, 지반조건 등' },
      { key: 'geology', title: '지반 및 지질 조건', type: 'text', placeholder: '암반등급, 지하수, 가스 존재여부 등' },
      { key: 'method', title: '굴진 방법 및 절차', type: 'text', placeholder: '굴착순서, 지보패턴, 버력처리 등', aiPrompt: '터널 굴진(쉴드/TBM 포함) 작업의 세부 절차와 안전조치를 작성해주세요.' },
      { key: 'ventilation', title: '환기 계획', type: 'text', placeholder: '환기방식, 풍량계산, 가스측정 계획' },
      { key: 'risk', title: '위험요인 및 안전대책', type: 'text', placeholder: '붕괴, 가스, 출수, 분진 등 위험요인과 대책', aiPrompt: '터널 굴진작업 시 발생 가능한 위험요인과 안전대책을 작성해주세요.' },
      { key: 'monitoring', title: '계측 계획', type: 'text', placeholder: '내공변위, 천단침하, 지표침하 계측' },
      { key: 'emergency', title: '비상시 조치계획', type: 'text', placeholder: '붕괴, 가스누출, 화재 시 대피경로 및 구조절차' },
    ],
    requiredAttachments: [
      '지반조사보고서',
      '터널 설계도면',
      '환기계산서',
      '지보패턴도',
      '비상대피경로도',
      '가스측정계획서',
    ],
  },
  {
    id: 'high_work',
    name: '고소 작업',
    legalBasis: '산업안전보건기준에 관한 규칙 제42조~제67조',
    description: '높이 2m 이상에서의 작업 (고소작업대, 사다리 등)',
    hasRiggingPlan: false,
    templateSections: [
      { key: 'overview', title: '작업 개요', type: 'text', placeholder: '작업위치, 높이, 작업내용, 사용장비 등' },
      { key: 'equipment', title: '작업발판 및 장비', type: 'table', placeholder: '고소작업대, 사다리, 안전그물 등' },
      { key: 'method', title: '작업 방법 및 절차', type: 'text', placeholder: '작업순서, 안전대 체결, 안전난간 설치 등', aiPrompt: '고소작업의 세부 절차와 추락방지 안전조치를 작성해주세요.' },
      { key: 'risk', title: '위험요인 및 안전대책', type: 'text', placeholder: '추락, 낙하물, 전도 등 위험요인과 대책' },
      { key: 'emergency', title: '비상시 조치계획', type: 'text', placeholder: '추락사고 발생 시 구조 및 응급처치 절차' },
    ],
    requiredAttachments: [
      '고소작업대 점검표',
      '안전대 점검기록',
      '작업발판 설치도',
    ],
  },
  {
    id: 'scaffold',
    name: '비계 작업',
    legalBasis: '산업안전보건기준에 관한 규칙 제56조~제77조',
    description: '비계(강관비계, 시스템비계 등) 조립/해체/사용 작업',
    hasRiggingPlan: false,
    templateSections: [
      { key: 'overview', title: '작업 개요', type: 'text', placeholder: '비계 종류, 높이, 설치위치, 용도 등' },
      { key: 'structure', title: '비계 구조 계획', type: 'text', placeholder: '비계 규격, 단수, 벽연결, 가새 등' },
      { key: 'method', title: '조립/해체 절차', type: 'text', placeholder: '조립순서, 해체순서, 자재반입 등', aiPrompt: '비계 조립 및 해체 작업의 세부 절차와 안전조치를 작성해주세요.' },
      { key: 'risk', title: '위험요인 및 안전대책', type: 'text', placeholder: '추락, 붕괴, 낙하 등 위험요인과 대책' },
      { key: 'inspection', title: '점검 계획', type: 'checklist', placeholder: '조립완료 후 점검, 정기점검, 악천후 후 점검' },
    ],
    requiredAttachments: [
      '비계 구조검토서',
      '조립도',
      '점검체크리스트',
    ],
  },
  {
    id: 'formwork',
    name: '거푸집 및 동바리',
    legalBasis: '산업안전보건기준에 관한 규칙 제329조~제337조',
    description: '거푸집/동바리 조립, 콘크리트 타설, 해체 작업',
    hasRiggingPlan: false,
    templateSections: [
      { key: 'overview', title: '작업 개요', type: 'text', placeholder: '구조물명, 규격, 타설계획 등' },
      { key: 'structure', title: '동바리 구조 계획', type: 'text', placeholder: '동바리 규격, 간격, 수평연결재 등' },
      { key: 'method', title: '작업 방법 및 절차', type: 'text', placeholder: '조립→검사→타설→양생→해체 순서', aiPrompt: '거푸집 및 동바리 작업의 세부 절차와 안전조치를 작성해주세요.' },
      { key: 'risk', title: '위험요인 및 안전대책', type: 'text', placeholder: '붕괴, 추락, 콘크리트 타설 시 위험' },
      { key: 'emergency', title: '비상시 조치계획', type: 'text', placeholder: '붕괴 시 대피 및 구조절차' },
    ],
    requiredAttachments: [
      '동바리 구조검토서',
      '거푸집 조립도',
      '콘크리트 타설계획서',
    ],
  },
  {
    id: 'steel',
    name: '철골 작업',
    legalBasis: '산업안전보건기준에 관한 규칙 제78조~제86조',
    description: '철골 세우기, 접합, 데크플레이트 설치 작업',
    hasRiggingPlan: true,
    templateSections: [
      { key: 'overview', title: '작업 개요', type: 'text', placeholder: '구조물명, 규격, 중량, 설치위치 등' },
      { key: 'equipment', title: '장비 정보', type: 'table', placeholder: '크레인, 고소작업대 등' },
      { key: 'method', title: '작업 방법 및 절차', type: 'text', placeholder: '인양→거치→가접합→본접합 순서', aiPrompt: '철골 세우기 작업의 세부 절차와 안전조치를 작성해주세요.' },
      { key: 'rigging', title: '리깅플랜', type: 'rigging', placeholder: '철골 부재 인양 계획' },
      { key: 'risk', title: '위험요인 및 안전대책', type: 'text', placeholder: '추락, 전도, 협착 등 위험요인과 대책' },
      { key: 'emergency', title: '비상시 조치계획', type: 'text', placeholder: '사고 발생 시 대응절차' },
    ],
    requiredAttachments: [
      '철골 세우기 계획도',
      '크레인 배치도',
      '접합상세도',
    ],
  },
  {
    id: 'demolition',
    name: '해체 작업',
    legalBasis: '산업안전보건기준에 관한 규칙 제87조~제92조, 건설기술진흥법 시행규칙 제60조',
    description: '건축물, 구조물 해체 작업',
    hasRiggingPlan: false,
    templateSections: [
      { key: 'overview', title: '작업 개요', type: 'text', placeholder: '해체 대상, 규모, 공법, 기간 등' },
      { key: 'survey', title: '사전조사 결과', type: 'text', placeholder: '석면조사, 구조안전진단, 매설물 확인 등' },
      { key: 'method', title: '해체 방법 및 절차', type: 'text', placeholder: '해체순서, 장비, 분진억제 등', aiPrompt: '건축물 해체 작업의 세부 절차와 안전조치를 작성해주세요.' },
      { key: 'risk', title: '위험요인 및 안전대책', type: 'text', placeholder: '붕괴, 분진, 소음, 낙하 등' },
      { key: 'emergency', title: '비상시 조치계획', type: 'text', placeholder: '비계획적 붕괴 시 대피절차' },
    ],
    requiredAttachments: [
      '해체계획서',
      '석면조사결과서',
      '구조안전진단서',
    ],
  },
  {
    id: 'explosives',
    name: '폭발물 사용 작업',
    legalBasis: '산업안전보건기준에 관한 규칙 제230조~제266조, 총포·도검·화약류 등의 안전관리에 관한 법률',
    description: '발파, 폭약 사용 작업',
    hasRiggingPlan: false,
    templateSections: [
      { key: 'overview', title: '작업 개요', type: 'text', placeholder: '발파 위치, 규모, 사용 화약량 등' },
      { key: 'method', title: '발파 방법 및 절차', type: 'text', placeholder: '천공→장약→결선→발파→검사 순서', aiPrompt: '발파 작업의 세부 절차와 안전조치를 작성해주세요.' },
      { key: 'safety_zone', title: '안전구역 설정', type: 'text', placeholder: '대피거리, 경계구역, 경보체계 등' },
      { key: 'risk', title: '위험요인 및 안전대책', type: 'text', placeholder: '폭발, 비석, 불발공 등 위험요인과 대책' },
      { key: 'emergency', title: '비상시 조치계획', type: 'text', placeholder: '불발공 처리, 사고 시 대응절차' },
    ],
    requiredAttachments: [
      '발파설계서',
      '화약류 사용허가서',
      '발파진동/소음 예측서',
      '대피계획도',
    ],
  },
  {
    id: 'confined_space',
    name: '밀폐공간 작업',
    legalBasis: '산업안전보건기준에 관한 규칙 제618조~제632조, KOSHA GUIDE H-80',
    description: '맨홀, 탱크, 지하피트 등 밀폐공간 내부 작업',
    hasRiggingPlan: false,
    templateSections: [
      { key: 'overview', title: '작업 개요', type: 'text', placeholder: '밀폐공간 위치, 규격, 작업내용 등' },
      { key: 'atmosphere', title: '대기 측정 계획', type: 'text', placeholder: '산소, 유해가스, 측정빈도, 측정기기 등' },
      { key: 'ventilation', title: '환기 계획', type: 'text', placeholder: '환기방식, 풍량, 환기시간 등' },
      { key: 'method', title: '작업 방법 및 절차', type: 'text', placeholder: '측정→환기→작업→감시 순서', aiPrompt: '밀폐공간 작업의 세부 절차와 안전조치를 작성해주세요.' },
      { key: 'risk', title: '위험요인 및 안전대책', type: 'text', placeholder: '질식, 중독, 폭발 등 위험요인과 대책' },
      { key: 'rescue', title: '구조 계획', type: 'text', placeholder: '구조장비, 구조절차, 감시인 배치 등' },
    ],
    requiredAttachments: [
      '밀폐공간 프로그램',
      '대기측정기록',
      '출입허가서',
      '구조장비 목록',
    ],
  },
  {
    id: 'other_hazardous',
    name: '기타 위험 작업',
    legalBasis: '산업안전보건법 제36조, 산업안전보건기준에 관한 규칙',
    description: '전기작업, 용접작업, 도장작업 등 기타 위험작업',
    hasRiggingPlan: false,
    templateSections: [
      { key: 'overview', title: '작업 개요', type: 'text', placeholder: '작업명, 작업위치, 작업내용 등' },
      { key: 'method', title: '작업 방법 및 절차', type: 'text', placeholder: '작업순서, 안전조치 등', aiPrompt: '해당 작업의 세부 절차와 안전조치를 작성해주세요.' },
      { key: 'risk', title: '위험요인 및 안전대책', type: 'text', placeholder: '작업별 위험요인과 대책' },
      { key: 'emergency', title: '비상시 조치계획', type: 'text', placeholder: '사고 발생 시 대응절차' },
    ],
    requiredAttachments: [
      '작업허가서',
      '장비점검표',
    ],
  },
];

export function getWorkPlanType(id: string): WorkPlanType | undefined {
  return WORK_PLAN_TYPES.find(t => t.id === id);
}

// 크레인 제원 데이터 (리깅플랜 계산용)
export interface CraneSpec {
  model: string;
  maxCapacity: number; // ton
  maxRadius: number; // m
  maxBoomLength: number; // m
  loadChart: { radius: number; capacity: number; boomLength: number }[];
}

export const COMMON_CRANES: CraneSpec[] = [
  {
    model: '25톤 카고크레인',
    maxCapacity: 25,
    maxRadius: 30,
    maxBoomLength: 30,
    loadChart: [
      { radius: 3, capacity: 25, boomLength: 10 },
      { radius: 5, capacity: 15, boomLength: 15 },
      { radius: 10, capacity: 8, boomLength: 20 },
      { radius: 15, capacity: 5, boomLength: 25 },
      { radius: 20, capacity: 3.2, boomLength: 30 },
      { radius: 25, capacity: 2.2, boomLength: 30 },
      { radius: 30, capacity: 1.6, boomLength: 30 },
    ],
  },
  {
    model: '50톤 크롤러크레인',
    maxCapacity: 50,
    maxRadius: 40,
    maxBoomLength: 42,
    loadChart: [
      { radius: 3, capacity: 50, boomLength: 12 },
      { radius: 5, capacity: 30, boomLength: 18 },
      { radius: 10, capacity: 18, boomLength: 24 },
      { radius: 15, capacity: 12, boomLength: 30 },
      { radius: 20, capacity: 8.5, boomLength: 36 },
      { radius: 25, capacity: 6, boomLength: 42 },
      { radius: 30, capacity: 4.5, boomLength: 42 },
      { radius: 35, capacity: 3.2, boomLength: 42 },
      { radius: 40, capacity: 2.3, boomLength: 42 },
    ],
  },
  {
    model: '100톤 유압크레인',
    maxCapacity: 100,
    maxRadius: 50,
    maxBoomLength: 50,
    loadChart: [
      { radius: 3, capacity: 100, boomLength: 12 },
      { radius: 5, capacity: 60, boomLength: 18 },
      { radius: 10, capacity: 35, boomLength: 24 },
      { radius: 15, capacity: 22, boomLength: 30 },
      { radius: 20, capacity: 15, boomLength: 36 },
      { radius: 25, capacity: 11, boomLength: 42 },
      { radius: 30, capacity: 8, boomLength: 48 },
      { radius: 40, capacity: 5, boomLength: 50 },
      { radius: 50, capacity: 3, boomLength: 50 },
    ],
  },
  {
    model: '200톤 크롤러크레인',
    maxCapacity: 200,
    maxRadius: 60,
    maxBoomLength: 60,
    loadChart: [
      { radius: 5, capacity: 120, boomLength: 18 },
      { radius: 10, capacity: 70, boomLength: 24 },
      { radius: 15, capacity: 45, boomLength: 30 },
      { radius: 20, capacity: 30, boomLength: 36 },
      { radius: 25, capacity: 22, boomLength: 42 },
      { radius: 30, capacity: 16, boomLength: 48 },
      { radius: 40, capacity: 10, boomLength: 54 },
      { radius: 50, capacity: 6.5, boomLength: 60 },
      { radius: 60, capacity: 4, boomLength: 60 },
    ],
  },
];

// 리깅플랜 계산 함수
export function calculateRigging(params: {
  loadWeight: number;
  workingRadius: number;
  craneModel: string;
}): { 
  isValid: boolean;
  safetyFactor: number;
  utilization: number;
  requiredCapacity: number;
  availableCapacity: number;
  message: string;
} {
  const crane = COMMON_CRANES.find(c => c.model === params.craneModel);
  if (!crane) return { isValid: false, safetyFactor: 0, utilization: 0, requiredCapacity: params.loadWeight, availableCapacity: 0, message: '크레인 정보를 찾을 수 없습니다.' };

  // Find closest load chart entry
  const sortedChart = [...crane.loadChart].sort((a, b) => Math.abs(a.radius - params.workingRadius) - Math.abs(b.radius - params.workingRadius));
  const closest = sortedChart[0];
  
  // Interpolate capacity at the working radius
  let availableCapacity = closest.capacity;
  const lower = crane.loadChart.filter(e => e.radius <= params.workingRadius).pop();
  const upper = crane.loadChart.find(e => e.radius >= params.workingRadius);
  
  if (lower && upper && lower !== upper) {
    const ratio = (params.workingRadius - lower.radius) / (upper.radius - lower.radius);
    availableCapacity = lower.capacity - ratio * (lower.capacity - upper.capacity);
  }

  // Safety factor (안전율): typically 80% for crane operations
  const safetyLimit = availableCapacity * 0.8;
  const utilization = (params.loadWeight / availableCapacity) * 100;
  const safetyFactor = availableCapacity / params.loadWeight;
  const isValid = params.loadWeight <= safetyLimit;

  let message = '';
  if (!isValid) {
    message = `⚠️ 정격하중 초과! 하중 ${params.loadWeight}톤 > 안전하중 ${safetyLimit.toFixed(1)}톤 (가용 ${availableCapacity.toFixed(1)}톤의 80%)`;
  } else if (utilization > 70) {
    message = `⚠️ 높은 가동률 (${utilization.toFixed(0)}%). 주의 필요.`;
  } else {
    message = `✅ 안전 범위 내 (가동률 ${utilization.toFixed(0)}%, 안전율 ${safetyFactor.toFixed(2)})`;
  }

  return { isValid, safetyFactor, utilization, requiredCapacity: params.loadWeight, availableCapacity, message };
}
