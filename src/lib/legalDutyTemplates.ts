// 안전관리자 법적업무 자동생성 템플릿
// 산업안전보건법, KOSHA 기준

export interface LegalDutyTemplate {
  id: string;
  name: string;
  category: 'daily' | 'weekly' | 'monthly' | 'event';
  frequency: string;
  legalBasis: string;
  description: string;
  applicableTypes?: string[];
}

export const LEGAL_DUTY_TEMPLATES: LegalDutyTemplate[] = [
  // ===== Daily =====
  {
    id: 'daily_tbm',
    name: '작업 전 안전점검(TBM)',
    category: 'daily',
    frequency: 'daily',
    legalBasis: '산업안전보건법 제36조, KOSHA GUIDE C-7',
    description: 'TBM(Tool Box Meeting) 실시 및 작업 전 위험요인 교육',
  },
  {
    id: 'daily_work_permit',
    name: '작업허가서 확인',
    category: 'daily',
    frequency: 'daily',
    legalBasis: '산업안전보건법 제36조, 산업안전보건기준에 관한 규칙 제35조',
    description: '위험작업 작업허가서 발급 및 확인',
  },
  {
    id: 'daily_ppe_check',
    name: '보호구 착용 점검',
    category: 'daily',
    frequency: 'daily',
    legalBasis: '산업안전보건법 제38조, 산업안전보건기준에 관한 규칙 제32조',
    description: '안전모, 안전화, 안전대 등 개인보호구 착용 확인',
  },
  {
    id: 'daily_hazard_control',
    name: '위험작업 통제 상태 확인',
    category: 'daily',
    frequency: 'daily',
    legalBasis: '산업안전보건법 제17조, 제18조',
    description: '현장 전체 순회 점검 및 위험작업 통제 상태 확인',
  },
  {
    id: 'daily_gas_measure',
    name: '밀폐공간 작업 전 산소농도 측정',
    category: 'daily',
    frequency: 'daily',
    legalBasis: '산업안전보건기준에 관한 규칙 제619조, 제382조',
    description: '산소농도, 유해가스 농도 측정 및 기록',
    applicableTypes: ['터널', '지하', '밀폐'],
  },

  // ===== Weekly =====
  {
    id: 'weekly_inspection',
    name: '정기 안전점검',
    category: 'weekly',
    frequency: 'weekly',
    legalBasis: '산업안전보건법 제36조, 건설기술진흥법 제62조',
    description: '주간 안전점검 실시 및 결과 기록/보고',
  },
  {
    id: 'weekly_safety_meeting',
    name: '협력사 안전회의',
    category: 'weekly',
    frequency: 'weekly',
    legalBasis: '산업안전보건법 제75조',
    description: '원도급-하도급 간 안전보건 협의 회의',
  },
  {
    id: 'weekly_workplan_check',
    name: '작업계획서 이행 점검',
    category: 'weekly',
    frequency: 'weekly',
    legalBasis: '산업안전보건법 제36조',
    description: '작업계획서 상 안전조치 이행 여부 현장 확인',
  },
  {
    id: 'weekly_risk_assessment_check',
    name: '위험성평가 이행 확인',
    category: 'weekly',
    frequency: 'weekly',
    legalBasis: '산업안전보건법 제36조, 고용노동부 고시 제2023-9호',
    description: '위험성평가 결과에 따른 안전조치 이행 여부 확인',
  },

  // ===== Monthly =====
  {
    id: 'monthly_safety_education',
    name: '정기 안전교육',
    category: 'monthly',
    frequency: 'monthly',
    legalBasis: '산업안전보건법 제29조, 시행규칙 제26조',
    description: '관리감독자 16시간/년, 근로자 6시간/분기 안전교육 실시',
  },
  {
    id: 'monthly_accident_stats',
    name: '산업재해 통계 및 보고',
    category: 'monthly',
    frequency: 'monthly',
    legalBasis: '산업안전보건법 제57조',
    description: '월간 산업재해 발생 현황 통계 및 보고서 작성',
  },
  {
    id: 'monthly_safety_plan_check',
    name: '안전관리계획 이행 점검',
    category: 'monthly',
    frequency: 'monthly',
    legalBasis: '산업안전보건법 제42조, 건설기술진흥법 제62조',
    description: '안전관리계획서 대비 이행 현황 점검',
  },
  {
    id: 'monthly_health_check',
    name: '근로자 건강관리 점검',
    category: 'monthly',
    frequency: 'monthly',
    legalBasis: '산업안전보건법 제129조, 제130조',
    description: '근로자 건강진단 이행 및 결과 관리 점검',
  },

  // ===== Event / 수시·법적 필수 =====
  {
    id: 'event_risk_assessment',
    name: '위험성평가 실시 및 기록',
    category: 'event',
    frequency: 'event',
    legalBasis: '산업안전보건법 제36조, 고용노동부 고시 제2023-9호',
    description: '작업 변경 또는 신규 작업 시 위험성평가 실시 및 기록 관리',
  },
  {
    id: 'event_work_plan',
    name: '작업계획서 작성 및 승인',
    category: 'event',
    frequency: 'event',
    legalBasis: '산업안전보건법 제36조, 산업안전보건기준에 관한 규칙',
    description: '법정 대상 공종 작업 시 작업계획서 작성 및 결재',
  },
  {
    id: 'event_special_education',
    name: '특별안전교육 실시',
    category: 'event',
    frequency: 'event',
    legalBasis: '산업안전보건법 제29조, 시행규칙 제26조',
    description: '위험작업(밀폐공간, 고소작업 등) 종사 전 특별안전교육 실시',
  },
  {
    id: 'event_heavy_lift_plan',
    name: '중량물 취급계획 수립',
    category: 'event',
    frequency: 'event',
    legalBasis: '산업안전보건기준에 관한 규칙 제171조',
    description: '중량물 인양 작업 시 양중계획(리깅플랜) 수립',
  },
  {
    id: 'event_confined_space',
    name: '밀폐공간 점검',
    category: 'event',
    frequency: 'event',
    legalBasis: '산업안전보건기준에 관한 규칙 제619조',
    description: '밀폐공간 작업 전 산소·유해가스 농도 측정 및 환기 확인',
  },
  {
    id: 'event_fall_prevention',
    name: '추락방지 조치 확인',
    category: 'event',
    frequency: 'event',
    legalBasis: '산업안전보건기준에 관한 규칙 제42조~제44조',
    description: '2m 이상 고소작업 시 안전난간, 추락방지망, 안전대 설치 확인',
  },
];

export function getDutiesByCategory(category: string): LegalDutyTemplate[] {
  return LEGAL_DUTY_TEMPLATES.filter(d => d.category === category);
}

export function getDutiesForConstructionType(constructionType: string): LegalDutyTemplate[] {
  return LEGAL_DUTY_TEMPLATES.filter(d => {
    if (!d.applicableTypes) return true;
    return d.applicableTypes.some(t => constructionType.includes(t));
  });
}

export function generateTodoDates(frequency: string, startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    dates.push(new Date(current));
    switch (frequency) {
      case 'daily':
        current.setDate(current.getDate() + 1);
        if (current.getDay() === 0) current.setDate(current.getDate() + 1);
        if (current.getDay() === 6) current.setDate(current.getDate() + 2);
        break;
      case 'weekly': current.setDate(current.getDate() + 7); break;
      case 'monthly': current.setMonth(current.getMonth() + 1); break;
      case 'quarterly': current.setMonth(current.getMonth() + 3); break;
      case 'annually': current.setFullYear(current.getFullYear() + 1); break;
      default: return dates;
    }
  }
  return dates;
}
