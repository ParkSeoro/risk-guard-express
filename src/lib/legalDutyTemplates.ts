// 안전관리자 법적업무 자동생성 템플릿
// 산업안전보건법, 건설기술진흥법 기준

export interface LegalDutyTemplate {
  id: string;
  name: string;
  category: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually' | 'event';
  frequency: string;
  legalBasis: string;
  description: string;
  applicableTypes?: string[]; // 특정 공사종류에만 해당
}

export const LEGAL_DUTY_TEMPLATES: LegalDutyTemplate[] = [
  // ===== Daily =====
  {
    id: 'daily_tbm',
    name: 'TBM(Tool Box Meeting) 실시',
    category: 'daily',
    frequency: 'daily',
    legalBasis: '산업안전보건법 제36조, KOSHA GUIDE C-7',
    description: '작업 전 근로자 대상 위험요인 교육 및 안전작업 방법 전달',
  },
  {
    id: 'daily_safety_check',
    name: '작업 전 안전점검',
    category: 'daily',
    frequency: 'daily',
    legalBasis: '산업안전보건법 제36조, 산업안전보건기준에 관한 규칙 제35조',
    description: '작업장 주변 환경, 장비, 안전시설 상태 점검',
  },
  {
    id: 'daily_ppe_check',
    name: '보호구 착용 상태 점검',
    category: 'daily',
    frequency: 'daily',
    legalBasis: '산업안전보건법 제38조, 산업안전보건기준에 관한 규칙 제32조',
    description: '안전모, 안전화, 안전대 등 개인보호구 착용 확인',
  },
  {
    id: 'daily_hazard_patrol',
    name: '안전순찰',
    category: 'daily',
    frequency: 'daily',
    legalBasis: '산업안전보건법 제17조, 제18조',
    description: '현장 전체 순회 점검 및 위험요인 확인/조치',
  },
  {
    id: 'daily_gas_measure',
    name: '가스농도 측정 (밀폐/터널)',
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
    id: 'weekly_scaffold_check',
    name: '비계 점검',
    category: 'weekly',
    frequency: 'weekly',
    legalBasis: '산업안전보건기준에 관한 규칙 제63조',
    description: '비계 구조, 연결부, 작업발판 상태 점검',
    applicableTypes: ['비계', '건축', '토목'],
  },
  {
    id: 'weekly_equipment_check',
    name: '건설기계 정기점검',
    category: 'weekly',
    frequency: 'weekly',
    legalBasis: '산업안전보건기준에 관한 규칙 제171조',
    description: '크레인, 굴착기 등 건설장비 상태 점검',
  },
  {
    id: 'weekly_safety_meeting',
    name: '안전보건협의체 회의',
    category: 'weekly',
    frequency: 'weekly',
    legalBasis: '산업안전보건법 제75조',
    description: '원도급-하도급 간 안전보건 협의 회의',
  },

  // ===== Monthly =====
  {
    id: 'monthly_safety_education',
    name: '정기 안전보건교육',
    category: 'monthly',
    frequency: 'monthly',
    legalBasis: '산업안전보건법 제29조, 시행규칙 제26조',
    description: '관리감독자 16시간/년, 근로자 6시간/분기 안전교육 실시',
  },
  {
    id: 'monthly_risk_assessment',
    name: '위험성평가 정기 검토',
    category: 'monthly',
    frequency: 'monthly',
    legalBasis: '산업안전보건법 제36조, 고용노동부 고시 제2023-9호',
    description: '위험성평가 결과의 적정성 검토 및 갱신',
  },
  {
    id: 'monthly_fire_check',
    name: '소방시설 점검',
    category: 'monthly',
    frequency: 'monthly',
    legalBasis: '산업안전보건기준에 관한 규칙 제241조, 소방시설법',
    description: '소화기, 소화전, 화재감지기 상태 점검',
  },
  {
    id: 'monthly_electrical_check',
    name: '전기설비 정기점검',
    category: 'monthly',
    frequency: 'monthly',
    legalBasis: '산업안전보건기준에 관한 규칙 제302조',
    description: '임시전력, 접지, 누전차단기 상태 점검',
  },

  // ===== Quarterly =====
  {
    id: 'quarterly_emergency_drill',
    name: '비상대피훈련',
    category: 'quarterly',
    frequency: 'quarterly',
    legalBasis: '산업안전보건법 제36조, KOSHA GUIDE G-1',
    description: '비상사태 시 대피훈련 및 응급처치 훈련 실시',
  },
  {
    id: 'quarterly_industrial_health',
    name: '작업환경측정',
    category: 'quarterly',
    frequency: 'quarterly',
    legalBasis: '산업안전보건법 제125조',
    description: '분진, 소음, 유해물질 등 작업환경 측정',
  },

  // ===== Annually =====
  {
    id: 'annual_safety_plan',
    name: '안전보건관리계획서 수립',
    category: 'annually',
    frequency: 'annually',
    legalBasis: '산업안전보건법 제42조, 건설기술진흥법 제62조',
    description: '연간 안전보건관리계획서 수립 및 제출',
  },
  {
    id: 'annual_health_check',
    name: '건강진단 실시',
    category: 'annually',
    frequency: 'annually',
    legalBasis: '산업안전보건법 제129조, 제130조',
    description: '일반건강진단, 특수건강진단 실시 및 결과 관리',
  },
  {
    id: 'annual_safety_inspection',
    name: '정기안전점검 (건설기술진흥법)',
    category: 'annually',
    frequency: 'annually',
    legalBasis: '건설기술진흥법 제62조',
    description: '건설공사 정기안전점검 실시 및 보고',
  },

  // ===== Event-based =====
  {
    id: 'event_new_worker',
    name: '신규 채용 시 교육',
    category: 'event',
    frequency: 'event',
    legalBasis: '산업안전보건법 제29조, 시행규칙 제26조',
    description: '신규 채용 근로자 안전보건교육 (8시간 이상)',
  },
  {
    id: 'event_work_change',
    name: '작업내용 변경 시 교육',
    category: 'event',
    frequency: 'event',
    legalBasis: '산업안전보건법 제29조',
    description: '작업내용 변경 시 2시간 이상 안전교육 실시',
  },
  {
    id: 'event_accident_report',
    name: '산업재해 발생 보고',
    category: 'event',
    frequency: 'event',
    legalBasis: '산업안전보건법 제57조, 중대재해처벌법 제4조',
    description: '산업재해 발생 시 즉시 보고 및 원인 조사',
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

// To-Do 생성 유틸리티
export function generateTodoDates(frequency: string, startDate: Date, endDate: Date): Date[] {
  const dates: Date[] = [];
  const current = new Date(startDate);
  
  while (current <= endDate) {
    dates.push(new Date(current));
    switch (frequency) {
      case 'daily':
        current.setDate(current.getDate() + 1);
        // 주말 건너뛰기
        if (current.getDay() === 0) current.setDate(current.getDate() + 1);
        if (current.getDay() === 6) current.setDate(current.getDate() + 2);
        break;
      case 'weekly':
        current.setDate(current.getDate() + 7);
        break;
      case 'monthly':
        current.setMonth(current.getMonth() + 1);
        break;
      case 'quarterly':
        current.setMonth(current.getMonth() + 3);
        break;
      case 'annually':
        current.setFullYear(current.getFullYear() + 1);
        break;
      default:
        return dates; // event-based: single occurrence
    }
  }
  return dates;
}
