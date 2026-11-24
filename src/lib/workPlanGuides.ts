/**
 * Phase 4: Adoption Guides for Existing & New Users.
 * - 30-second 4-step interactive speech-bubble tour (`WORK_PLAN_TOUR_STEPS`)
 * - Statutory legal term glossary + KOSHA writing examples per section key
 */

export const WORK_PLAN_TOUR_STORAGE_KEY = 'safenex_workplan_tour_v1_seen';

export interface WorkPlanTourStep {
  id: string;
  stepNumber: number;
  title: string;
  body: string;
  tip: string;
  targetTab?: 'basic' | 'sections' | 'attachments' | 'preview';
}

export const WORK_PLAN_TOUR_STEPS: WorkPlanTourStep[] = [
  {
    id: 'layout',
    stepNumber: 1,
    title: '익숙한 탭 구조는 그대로, 상단은 깔끔하게',
    body: '기존에 쓰시던 탭(기본정보·내용 작성·첨부파일·미리보기)은 그대로 유지됩니다. 자주 보지 않는 보조 카드는 상단 한 줄 요약으로 접어 두었으니 필요할 때만 펼쳐 보세요.',
    tip: '관리감독자를 지정하고 작업기간을 입력하면 기본 준비가 끝납니다.',
    targetTab: 'basic',
  },
  {
    id: 'legal_help',
    stepNumber: 2,
    title: '어려운 법령 용어는 ? 말풍선과 KOSHA 예시로',
    body: '산안법 별표 4 필수 항목 옆의 [?] 버튼을 누르면 법적 근거와 쉬운 설명, KOSHA 표준 작성 예시를 바로 볼 수 있습니다.',
    tip: '중량물 취급 작업은 별표 4 5대 위험(추락·낙하·전도·협착·붕괴)을 모두 채워야 상신됩니다.',
    targetTab: 'sections',
  },
  {
    id: 'ai_ocr_vault',
    stepNumber: 3,
    title: 'AI 자동 판독 + 업체 서류 보관함 1클릭 재사용',
    body: '첨부파일 탭 임시함에 사진·PDF를 한꺼번에 넣고 [AI 자동 분류]를 누르면 서류 종류와 유효기간을 판독해 추천합니다. [재사용 저장]을 켜두면 다음 계획서에서 1클릭으로 불러올 수 있습니다.',
    tip: '발주처·현장 추가 서류는 맨 아래 [+ 기타 증빙 추가]로 자유롭게 올리세요.',
    targetTab: 'attachments',
  },
  {
    id: 'next_action',
    stepNumber: 4,
    title: '하단 "다음 할 일" 바 따라가면 결재 상신 완료',
    body: '화면 맨 아래 고정 바가 지금 남은 필수 항목을 알려줍니다. 항목을 클릭하면 바로 해당 위치로 이동하며, 결재 상신 후 검토자는 본문과 첨부 원본을 좌우로 나란히 검토합니다.',
    tip: '이 안내는 상단 [? 화면 안내] 버튼에서 언제든 다시 열 수 있습니다.',
    targetTab: 'preview',
  },
];

export interface SectionLegalHint {
  term: string;
  legalBasis: string;
  plainExplanation: string;
  koshaExample: string;
}

const SECTION_HINTS: Record<string, SectionLegalHint> = {
  risk: {
    term: '별표 4 위험요인 및 안전대책',
    legalBasis: '산업안전보건기준에 관한 규칙 제38조·별표 4',
    plainExplanation:
      '작업 중 발생 가능한 핵심 위험요인(중량물의 경우 추락·낙하·전도·협착·붕괴 5대 위험)별로 구체적인 예방조치를 기재해야 합니다.',
    koshaExample:
      '• [낙하] 인양물 하부 출입통제선(반경 12m) 설치 및 유도 로프 2본 체결\n• [전도] 아웃트리거 최대 인출 및 지반 철판(t=22mm) 부설 후 수평도 확인\n• [협착] 신호수 전담 배치(무전기 CH 3) 및 장비 선회반경 내 작업자 접근 금지',
  },
  commander: {
    term: '작업지휘자 지정 및 근로자 주지',
    legalBasis: '산업안전보건기준에 관한 규칙 제38조 제2항·제39조',
    plainExplanation:
      '작업지휘자를 지정해 작업계획서 내용대로 작업을 지휘하도록 하고, 작업 시작 전 TBM 등을 통해 근로자에게 계획서 내용을 반드시 알려야(주지) 합니다.',
    koshaExample:
      '• 작업지휘자: 홍길동 과장 (현장 안전교육 이수, 상주 지휘)\n• 주지 방법: 작업 당일 07:30 TBM 시 작업순서·신호방법·비상대피로 교육 및 참석 서명 확보',
  },
  route: {
    term: '운행·운반경로 및 지반 상태',
    legalBasis: '산업안전보건기준에 관한 규칙 제38조·별표 4',
    plainExplanation:
      '장비나 중량물이 이동하는 동선, 경사도, 지반 지지력, 지하매설물·고압선 이격거리를 사전에 확인해 기재합니다.',
    koshaExample:
      '• 진입 동선: 서측 게이트 → 가설도로(폭 6m, 다짐 완료) → B동 북측 거치 위치\n• 장애물 확인: 상부 가설전선 이격거리 5m 이상 확보, 맨홀 구간 복공판 보강 완료',
  },
  loto: {
    term: '잠금장치·표지판(LOTO) 및 단락접지',
    legalBasis: '산업안전보건기준에 관한 규칙 제319조·별표 4',
    plainExplanation:
      '정전 작업 시 타인이 실수로 전원을 투입하지 못하도록 개폐기에 자물쇠(Lock)와 통전금지 표지판(Tag)을 걸고, 검전기 확인 후 단락접지기구를 설치하는 절차입니다.',
    koshaExample:
      '• 1단계: 주 차단기(MCCB-04) 개방 → 개인 자물쇠 시건 + "작업 중 투입금지" 표지판 부착\n• 2단계: 특고압 검전기로 무전압 확인 → 단락접지기구(접지봉→전선 순) 체결',
  },
  isolation: {
    term: '차단·퍼지·치환 (화학설비)',
    legalBasis: '산업안전보건기준에 관한 규칙 제261조~제301조·별표 4',
    plainExplanation:
      '배관·탱크 개방 전 유해·위험물질 유입을 맹판(Blind) 등으로 완전히 차단하고, 질소·공기 등으로 내부 잔류 가스를 불어내(퍼지) 안전한 농도로 치환하는 조치입니다.',
    koshaExample:
      '• 차단: 인입·토출 밸브 이중 차단 후 맹판(Blind Flange) 체결 및 LOTO 부착\n• 퍼지: 질소(N2) 치환 → 공기 환기 후 산소 19.5~23.5%, 가연성가스 0% LEL 측정 확인',
  },
  bench_slope: {
    term: '굴착면 기울기 및 소단(벤치)',
    legalBasis: '산업안전보건기준에 관한 규칙 제338조·별표 4',
    plainExplanation:
      '토사·암반 붕괴를 막기 위해 지반 종류별 법정 기울기를 지키고, 높이가 큰 사면 중간에 계단식 평탄부(소단)를 두어 낙석과 붕괴 에너지를 줄이는 조치입니다.',
    koshaExample:
      '• 사면 기울기: 풍화암 1:0.8 적용, 수직고 5m마다 폭 1.5m 이상 소단(벤치) 설치\n• 낙석 방지: 작업 전 상부 부석(뜬돌) 제거 및 하부 방호망 설치',
  },
  support_water: {
    term: '지보공 설치 및 용수·출수 대책',
    legalBasis: '산업안전보건기준에 관한 규칙 제365조~제389조·별표 4',
    plainExplanation:
      '터널 굴진 시 붕락 방지를 위한 지보 패턴(강지보·록볼트·숏크리트)과 지하수 유입(출수) 시 배수·차수 및 대피 기준을 기재합니다.',
    koshaExample:
      '• 지보 패턴: RMR 3등급 구간 숏크리트 t=120mm, 록볼트 L=3m(간격 1.5m) 즉시 타설\n• 출수 대책: 막장 선진수평보링 실시, 유입량 50L/min 초과 시 작업 중지 및 그라우팅 보강',
  },
  sequence_protect: {
    term: '해체물 낙하·비래 방호 및 출입통제',
    legalBasis: '산업안전보건기준에 관한 규칙 제38조·별표 4',
    plainExplanation:
      '해체 순서(상부→하부, 비내력→내력벽)와 파편 비산 방지용 방진막·낙하물 방지망 설치, 하부 통제 구역 설정 내용을 기재합니다.',
    koshaExample:
      '• 해체 순서: 내부 마감재 철거 → 옥상 파라펫 → 슬래브 → 보 → 기둥 순 상부하향식 해체\n• 방호 조치: 외주 시스템비계 + 방음·방진패널 설치, 살수기 2대 상시 가동',
  },
  traffic_control: {
    term: '교량 하부 통행·교통통제 및 낙하물 방호',
    legalBasis: '산업안전보건기준에 관한 규칙 제38조 제1항 제8호·별표 4',
    plainExplanation:
      '교량 상부 가설·해체 중 하부 도로·보행자·하천으로 공구·부재가 떨어지지 않도록 방호설비와 신호수·교통통제 계획을 기재합니다.',
    koshaExample:
      '• 교통통제: 거더 거치 시간대(01:00~04:00) 하부 2개 차로 전면 통제, 유도요원 4명 배치\n• 낙하 방호: 작업구간 하부 낙하물 방지망(방염) 이중 설치 및 공구 이탈방지줄 체결',
  },
  supervisor: {
    term: '작업지휘자 및 전담 감시인 배치',
    legalBasis: '산업안전보건기준에 관한 규칙 제318조·제321조',
    plainExplanation:
      '고압·활선 근접 전기작업 시 충전부 접근한계 이탈을 감시하고 비상 시 즉시 전원을 차단할 전담 감시인과 지휘자를 지정합니다.',
    koshaExample:
      '• 작업지휘자: 김전기 과장(전기기사) / 전담 감시인: 이안전 대리(타 업무 겸직 금지)\n• 비상 연락: 수변전실 직통 무전기 상시 개방 및 절연 구출봉 현장 비치',
  },
  signal: {
    term: '신호체계 및 신호수 배치',
    legalBasis: '산업안전보건기준에 관한 규칙 제40조',
    plainExplanation:
      '장비 운전원과 작업자 간 오신호로 인한 협착·낙하 사고를 막기 위해 전담 신호수와 통일된 신호 방법(수신호·무전기)을 정합니다.',
    koshaExample:
      '• 전담 신호수 1명 배치(형광 조끼·호루라기 착용, 무전기 전용 CH 3 사용)\n• 신호 두절 또는 시야 미확보 시 즉시 작업 중지 원칙 적용',
  },
};

export function findSectionLegalHint(sectionKey: string, _workType?: string): SectionLegalHint | null {
  return SECTION_HINTS[sectionKey] ?? null;
}

export function hasSeenWorkPlanTour(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(WORK_PLAN_TOUR_STORAGE_KEY) === '1';
  } catch {
    return true;
  }
}

export function markWorkPlanTourSeen(): void {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(WORK_PLAN_TOUR_STORAGE_KEY, '1');
    }
  } catch {
    // ignore storage quota/privacy mode errors
  }
}
