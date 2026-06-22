// 공종별 첨부자료 자동 생성 템플릿 (KOSHA 기준)
// 작업 유형과 조건에 따라 필수 첨부자료 목록을 자동으로 생성

export type AttachmentKind = 'legal' | 'calc_evidence' | 'site_proof';
export type AttachmentAutoSource = 'equipment' | 'msds' | 'env_measurement' | 'cert' | 'rigging' | 'risk_assessment';

export interface AttachmentItem {
  key: string;
  name: string;
  required: boolean;
  description: string;
  category: string;
  /** 3계층 분류 — 결재 차단 여부 결정 (legal 누락 시만 차단) */
  kind?: AttachmentKind;
  /** 자동 첨부 출처 — 지정 시 다른 모듈 데이터에서 끌어옴 */
  autoSource?: AttachmentAutoSource;
}


interface AttachmentCondition {
  field: string;
  value: string;
  attachments: AttachmentItem[];
}

// 공통 필수 첨부서류 (모든 공종에 적용)
const COMMON_ATTACHMENTS: AttachmentItem[] = [
  { key: 'biz_license', name: '사업자등록증', required: true, description: '시공업체 사업자등록증 사본', category: '공통서류' },
  { key: 'insurance_cert', name: '보험가입증명서', required: true, description: '산재보험, 고용보험, 영업배상 등', category: '공통서류' },
  { key: 'safety_training', name: '안전보건교육 이수증', required: true, description: '근로자 안전보건교육 이수 증빙', category: '공통서류' },
  { key: 'risk_assessment', name: '위험성평가서', required: true, description: '해당 작업에 대한 위험성평가 결과', category: '공통서류' },
  { key: 'work_instruction', name: '작업지휘자 지정서', required: true, description: '작업지휘자 선임 및 지정 서류', category: '공통서류' },
];

// 장비 사용 시 필수 첨부서류
const EQUIPMENT_ATTACHMENTS: AttachmentItem[] = [
  { key: 'vehicle_reg', name: '차량등록증', required: true, description: '건설기계 등록증 사본', category: '장비서류' },
  { key: 'vehicle_insurance', name: '보험증권', required: true, description: '건설기계 보험 가입 증권', category: '장비서류' },
  { key: 'inspection_cert', name: '검사증(안전검사)', required: true, description: '정기검사 또는 안전검사 합격증', category: '장비서류' },
  { key: 'operator_license', name: '운전면허증/자격증', required: true, description: '장비 운전원 면허 또는 조종사 자격증', category: '장비서류' },
  { key: 'equipment_spec', name: '장비제원표', required: true, description: '장비 사양 및 제원 (정격하중 등)', category: '장비서류' },
];

// 공종별 기본 첨부자료
const BASE_ATTACHMENTS: Record<string, AttachmentItem[]> = {
  heavy_lifting: [
    { key: 'crane_spec', name: '크레인 제원표', required: true, description: '사용 크레인의 정격하중, 작업반경 등 제원', category: '장비' },
    { key: 'radius_chart', name: '작업 반경도', required: true, description: '크레인 작업반경 및 양중구간 도면', category: '도면' },
    { key: 'ground_review', name: '지반 지지력 검토서', required: true, description: '크레인 설치 지반의 지지력 검토', category: '구조' },
    { key: 'rigging_plan', name: '리깅플랜', required: true, description: '양중 하중계산, 장비선정, 와이어 규격', category: '계획' },
    { key: 'sling_inspection', name: '슬링/와이어 검사표', required: true, description: '사용 슬링 및 와이어로프 점검기록', category: '점검' },
    { key: 'sling_safety_review', name: '줄걸이 안전성 검토', required: true, description: '줄걸이 및 체결장구 안전성 검토서', category: '계획' },
    { key: 'work_sequence', name: '작업순서도', required: true, description: '양중 작업 단계별 절차도', category: '절차' },
    { key: 'signal_system', name: '신호체계도', required: true, description: '신호수 배치 및 신호방법', category: '안전' },
    { key: 'control_plan', name: '통제계획서', required: true, description: '작업구역 출입통제 및 안전구역 설정', category: '안전' },
    { key: 'signal_designate', name: '신호수/유도원 지정서', required: true, description: '신호수 및 유도원 선임 서류', category: '안전' },
    { key: 'ndt_report', name: '비파괴검사 결과서', required: false, description: '크레인 후크 등 비파괴검사 결과(해당 시)', category: '점검' },
    { key: 'rental_record', name: '기계등 대여사항 기록부', required: true, description: '기계 대여 시 대여자 의무 기록부', category: '관리' },
    { key: 'safety_checklist_crane', name: '이동식크레인 안전점검표', required: true, description: '일상/정기 안전점검표', category: '점검' },
    { key: 'load_warning', name: '정격하중 표시/경고표지', required: true, description: '정격하중 표시 및 매달린 물체 경고표지', category: '안전' },
  ],
  excavation: [
    { key: 'geo_report', name: '지반조사보고서', required: true, description: '지질조사 결과 및 토질 분석', category: '조사' },
    { key: 'excavation_plan', name: '굴착계획도', required: true, description: '굴착 범위, 깊이, 사면 기울기', category: '도면' },
    { key: 'shoring_calc', name: '흙막이 구조계산서', required: true, description: '흙막이 구조물 안전성 검토', category: '구조' },
    { key: 'monitoring_plan', name: '계측계획서', required: true, description: '내공변위, 침하 등 계측 계획', category: '계획' },
    { key: 'utility_check', name: '지하매설물 확인서', required: true, description: '매설관, 케이블 등 확인', category: '조사' },
  ],
  tunnel: [
    { key: 'geo_report', name: '지반조사보고서', required: true, description: '지질, 암반등급, 지하수위 등', category: '조사' },
    { key: 'tunnel_drawing', name: '터널 설계도면', required: true, description: '터널 단면, 지보패턴 등', category: '도면' },
    { key: 'ventilation_calc', name: '환기계산서', required: true, description: '환기풍량 산정 및 배치', category: '구조' },
    { key: 'support_pattern', name: '지보패턴도', required: true, description: '암반등급별 지보 패턴', category: '도면' },
    { key: 'evacuation_route', name: '비상대피경로도', required: true, description: '화재, 붕괴 시 대피경로', category: '안전' },
    { key: 'gas_measurement', name: '가스측정계획서', required: true, description: '유해가스 측정 방법 및 빈도', category: '계획' },
  ],
  high_work: [
    { key: 'platform_check', name: '고소작업대 점검표', required: true, description: '고소작업대 일상점검 기록', category: '점검' },
    { key: 'harness_check', name: '안전대 점검기록', required: true, description: '안전대 및 부속품 점검', category: '점검' },
    { key: 'platform_drawing', name: '작업발판 설치도', required: true, description: '작업발판 설치 위치 및 규격', category: '도면' },
  ],
  scaffold: [
    { key: 'struct_review', name: '비계 구조검토서', required: true, description: '비계 구조 안전성 검토', category: '구조' },
    { key: 'assembly_drawing', name: '비계 조립도', required: true, description: '비계 조립 상세도', category: '도면' },
    { key: 'checklist', name: '비계 점검체크리스트', required: true, description: '조립 후 및 정기점검 기록', category: '점검' },
    { key: 'scaffold_cert', name: '비계기능사 자격증', required: true, description: '비계 조립/해체 기능사 자격증', category: '자격' },
  ],
  formwork: [
    { key: 'struct_review', name: '동바리 구조검토서', required: true, description: '동바리 구조계산 및 안전성 검토', category: '구조' },
    { key: 'assembly_drawing', name: '거푸집 조립도', required: true, description: '거푸집 및 동바리 조립 상세', category: '도면' },
    { key: 'concrete_plan', name: '콘크리트 타설계획서', required: true, description: '타설순서, 양생 계획', category: '계획' },
  ],
  steel: [
    { key: 'erection_plan', name: '철골 세우기 계획도', required: true, description: '철골 세우기 순서 및 배치', category: '도면' },
    { key: 'crane_layout', name: '크레인 배치도', required: true, description: '크레인 위치 및 작업반경', category: '도면' },
    { key: 'joint_detail', name: '접합상세도', required: true, description: '볼트, 용접 접합 상세', category: '도면' },
  ],
  demolition: [
    { key: 'demolition_plan', name: '해체계획서', required: true, description: '해체 순서, 방법, 장비', category: '계획' },
    { key: 'asbestos_report', name: '석면조사결과서', required: true, description: '석면 함유 여부 조사', category: '조사' },
    { key: 'safety_diagnosis', name: '구조안전진단서', required: true, description: '구조물 안전성 진단', category: '구조' },
  ],
  confined_space: [
    { key: 'program', name: '밀폐공간 프로그램', required: true, description: '밀폐공간 작업 프로그램', category: '계획' },
    { key: 'atmosphere_record', name: '대기측정기록', required: true, description: '산소/유해가스 측정기록', category: '점검' },
    { key: 'entry_permit', name: '출입허가서', required: true, description: '밀폐공간 출입허가 서류', category: '안전' },
    { key: 'rescue_equipment', name: '구조장비 목록', required: true, description: '구조용 장비 보유 현황', category: '안전' },
  ],
  explosives: [
    { key: 'blast_design', name: '발파설계서', required: true, description: '발파 패턴 및 장약량 설계', category: '계획' },
    { key: 'explosives_permit', name: '화약류 사용허가서', required: true, description: '관할 관청 허가서', category: '인허가' },
    { key: 'vibration_prediction', name: '발파진동/소음 예측서', required: true, description: '진동, 소음 영향 예측', category: '조사' },
    { key: 'evacuation_plan', name: '대피계획도', required: true, description: '발파 시 대피구역 설정', category: '안전' },
  ],
  other_hazardous: [
    { key: 'work_permit', name: '작업허가서', required: true, description: '위험작업 허가 서류', category: '인허가' },
    { key: 'equipment_check', name: '장비점검표', required: true, description: '사용 장비 점검기록', category: '점검' },
  ],
};

// 조건별 추가 첨부자료
const CONDITIONAL_ATTACHMENTS: AttachmentCondition[] = [
  {
    field: 'night_work',
    value: 'true',
    attachments: [
      { key: 'lighting_plan', name: '야간 조도계획서', required: true, description: '야간작업 시 조도 확보 계획 (작업면 150Lux 이상)', category: '안전' },
      { key: 'night_safety', name: '야간작업 안전관리계획', required: true, description: '야간 안전인력 배치, 비상연락망', category: '안전' },
    ],
  },
  {
    field: 'road_work',
    value: 'true',
    attachments: [
      { key: 'traffic_control', name: '교통통제계획서', required: true, description: '도로점용, 교통안전시설, 신호수 배치', category: '안전' },
      { key: 'road_permit', name: '도로사용허가서', required: true, description: '도로관리청 도로점용 허가', category: '인허가' },
    ],
  },
  {
    field: 'hot_work',
    value: 'true',
    attachments: [
      { key: 'fire_permit', name: '화기작업허가서', required: true, description: '용접, 절단 등 화기작업 허가', category: '인허가' },
      { key: 'fire_watch', name: '화재감시계획', required: true, description: '화재감시인 배치 및 소화기 비치', category: '안전' },
    ],
  },
  {
    field: 'near_power_lines',
    value: 'true',
    attachments: [
      { key: 'power_clearance', name: '활선 이격거리 검토서', required: true, description: '고압선 이격거리 확보 검토', category: '안전' },
    ],
  },
];

// 장비 사용 공종 (장비서류 필수)
const EQUIPMENT_REQUIRED_TYPES = [
  'heavy_lifting', 'excavation', 'tunnel', 'steel', 'demolition',
];

/**
 * 공종 및 조건에 따른 필수 첨부자료 자동 생성
 */
export function generateAttachments(
  workType: string,
  conditions?: Record<string, string>
): AttachmentItem[] {
  const result: AttachmentItem[] = [...COMMON_ATTACHMENTS];

  // 장비 사용 공종이면 장비서류 추가
  if (EQUIPMENT_REQUIRED_TYPES.includes(workType)) {
    result.push(...EQUIPMENT_ATTACHMENTS);
  }

  // 공종별 고유 첨부자료
  const base = BASE_ATTACHMENTS[workType] || BASE_ATTACHMENTS['other_hazardous'];
  result.push(...base);

  // 조건별 추가
  if (conditions) {
    for (const cond of CONDITIONAL_ATTACHMENTS) {
      if (conditions[cond.field] === cond.value) {
        for (const att of cond.attachments) {
          if (!result.find(r => r.key === att.key)) {
            result.push(att);
          }
        }
      }
    }
  }

  return result;
}

export function getAttachmentCategories(attachments: AttachmentItem[]): string[] {
  return [...new Set(attachments.map(a => a.category))];
}

/**
 * 필수 첨부서류 중 미업로드 항목 확인
 */
export function getMissingRequiredAttachments(
  workType: string,
  uploadedKeys: string[],
  conditions?: Record<string, string>
): AttachmentItem[] {
  const all = generateAttachments(workType, conditions);
  return all.filter(a => a.required && !uploadedKeys.includes(a.key));
}
