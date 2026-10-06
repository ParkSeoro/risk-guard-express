/** Session types the site itself teaches. Certificates and checkups are not sessions. */
export const EDUCATION_SESSION_TYPES = [
  "regular",
  "new_hire",
  "job_change",
  "special",
  "manager",
  "msds",
] as const;

export type EducationSessionType = (typeof EDUCATION_SESSION_TYPES)[number];

export type EducationOutline = {
  title: string;
  hoursHint: string;
  defaultHours: number;
  outline: string;
};

/**
 * 별표 5 주제를 현장 진행표로 옮긴 것. 공단 교재 전문은 넣지 않는다.
 */
export const EDUCATION_OUTLINES: Record<EducationSessionType, EducationOutline> = {
  regular: {
    title: "정기 안전보건교육",
    hoursHint: "사무직은 반기 6시간, 그 외 상시근로자는 반기 12시간. 한 번에 채우지 않아도 됩니다.",
    defaultHours: 1,
    outline: [
      "1. 산업안전보건법과 이 현장의 안전보건관리 계획",
      "2. 최근 사고 사례와 오늘 작업의 위험요인",
      "3. 보호구 착용, 작업 전 점검, 작업중지 요청",
      "4. 건강장해 예방, 직무스트레스, 직장 내 괴롭힘 예방",
      "5. 오늘 교육에서 확인한 현장 준수사항",
    ].join("\n"),
  },
  new_hire: {
    title: "채용 시 교육",
    hoursHint: "일용·1주 이하는 1시간, 1주 초과 1개월 이하는 4시간, 그 외는 8시간. 작업 시작 전.",
    defaultHours: 1,
    outline: [
      "1. 현장 출입, 이동 통로, 비상 대피",
      "2. 오늘 맡은 작업의 위험과 금지사항",
      "3. 보호구와 작업 전 점검",
      "4. 사고 시 신고와 작업중지",
      "5. 산업재해보상보험과 안전보건 연락처",
    ].join("\n"),
  },
  job_change: {
    title: "작업내용 변경 시 교육",
    hoursHint: "일용·1주 이하는 1시간, 그 외는 2시간. 바뀐 작업을 시작하기 전.",
    defaultHours: 1,
    outline: [
      "1. 바뀐 작업의 내용과 위험요인",
      "2. 기계·기구와 작업 방법에서 달라진 점",
      "3. 필요한 보호구와 작업 전 점검",
      "4. 주변 작업과 겹칠 때 막을 것",
    ].join("\n"),
  },
  special: {
    title: "특별교육",
    hoursHint: "일용·단기간·간헐 작업은 2시간. 상시는 시작 전 4시간과 3개월 안의 나머지 시간.",
    defaultHours: 2,
    outline: [
      "1. 이 위험작업의 이름과 법령상 특별교육 대상인 이유",
      "2. 작업 순서, 위험요인, 재해 사례",
      "3. 안전작업 방법과 금지사항",
      "4. 보호구, 작업 전 점검, 비상 조치",
      "5. 질문과 이해 확인",
    ].join("\n"),
  },
  manager: {
    title: "관리감독자 정기교육",
    hoursHint: "관리감독자 연 16시간. 안전관리자 직무교육은 교육기관 이수증이며 이 회차가 아닙니다.",
    defaultHours: 2,
    outline: [
      "1. 관리감독자가 확인할 작업 시작 전 점검",
      "2. 소속 근로자의 위험작업과 보호구",
      "3. 유해·위험요인 개선과 작업중지",
      "4. 교육·건강진단 실시 여부와 기록",
    ].join("\n"),
  },
  msds: {
    title: "MSDS 교육",
    hoursHint: "그 물질을 취급하기 전, 취급 근로자에게 실시합니다.",
    defaultHours: 1,
    outline: [
      "1. 물질 이름, 그림문자, 유해성",
      "2. 취급 방법, 저장, 누출 시 조치",
      "3. 보호구와 응급조치",
      "4. 경고표지 위치와 폐기",
    ].join("\n"),
  },
};

export function isEducationSessionType(value: string): value is EducationSessionType {
  return (EDUCATION_SESSION_TYPES as readonly string[]).includes(value);
}
