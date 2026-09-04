// 화면별 도움말 사전 - 라우트 prefix → 도움말
export type HelpEntry = {
  title: string;
  steps: string[];
  tip?: string;
};

export const HELP: Record<string, HelpEntry> = {
  "/": {
    title: "대시보드",
    steps: [
      "현장 KPI(위험성평가, 작업허가, TBM, 점검 현황)를 한눈에 확인합니다.",
      "각 카드 클릭 시 해당 메뉴로 이동합니다.",
    ],
    tip: "상단 프로젝트 선택을 바꾸면 모든 화면이 해당 현장 기준으로 전환됩니다.",
  },
  "/risk-assessment": {
    title: "위험성평가",
    steps: [
      "+ 새 평가 클릭 → 작업명/공종 선택",
      "AI 자동생성 버튼으로 항목 초안 생성",
      "3x3 매트릭스(빈도×강도)로 등급 산정",
      "'고' 등급은 사진(전·후) 첨부 필수",
      "결재 상신 → 검증센터 통과 시 승인 진행",
    ],
    tip: "법령 근거 표시 ON/OFF는 출력물 옵션에서 변경 가능합니다.",
  },
  "/work-plans": {
    title: "작업계획서",
    steps: [
      "법정 11종 템플릿에서 작업 유형 선택",
      "7개 탭(개요·장비·절차·위험·대책·첨부·결재) 순서로 작성",
      "AI 교육자료 자동생성 토글 ON 권장",
      "필수 첨부 누락 시 결재 상신 차단",
    ],
  },
  "/work-permits": {
    title: "작업허가서",
    steps: [
      "위험작업 유형(화기/밀폐/고소/굴착 등) 선택",
      "관련 위험성평가/작업계획서 연결",
      "허가 승인 후 TBM·입장·교육 조건 충족 시 작업 가능",
    ],
    tip: "조건 미충족 시 시스템에서 작업이 자동 차단됩니다.",
  },
  "/tbm-logs": {
    title: "TBM 일지",
    steps: [
      "허가서 발행 시 당일 TBM이 만들어지거나, 여기서 직접 생성",
      "근로자 출근 서명이 TBM 참여 서명으로 붙음 (QR은 선택)",
      "실시 사진을 올리고 일지를 인쇄",
    ],
  },
  "/safety-inspections": {
    title: "안전점검",
    steps: [
      "점검 템플릿 선택(일일/주간/월간/법정)",
      "항목별 적합/부적합 + 사진 첨부",
      "부적합 시 담당자에게 자동 알림 + 조치 요청 생성",
    ],
  },
  "/workers": {
    title: "근로자 관리",
    steps: [
      "회사를 선택 후 등록 QR 생성 → 인쇄해 현장 게시",
      "근로자가 QR 스캔 시 회사가 자동 지정됨",
      "등록된 근로자 목록·소속·연락처 확인",
    ],
  },
  "/worker-attendance": {
    title: "입퇴장 현황",
    steps: [
      "실시간 현장 인원 현황 확인",
      "입장/퇴장 시간 + 전자서명 기록 조회",
      "일자별/회사별 필터 제공",
    ],
  },
  "/education-materials": {
    title: "교육자료",
    steps: [
      "위험성평가 또는 작업계획서를 선택해 AI 자료 자동 생성",
      "PPT(관리자), PDF(현장), TBM 요약본 출력",
      "자료 수정 후 재저장 가능",
    ],
  },
  "/safety-cost": {
    title: "산업안전보건관리비",
    steps: [
      "공사금액 기준 법정 요율 자동 계산",
      "집행/잔액/사용 내역 등록 및 영수증 첨부",
      "월별/연간 집행률 리포트 출력",
    ],
    tip: "공식 명칭은 '산업안전보건관리비' (구. 안관비)입니다.",
  },
  "/legal-duties": {
    title: "법적업무 (안전관리자 22대 의무)",
    steps: [
      "법정 의무 22항목의 이행 현황 확인",
      "주기별 할 일 자동 생성",
      "이행 증빙 첨부 후 완료 처리",
    ],
  },
  "/approvals": {
    title: "전자결재",
    steps: [
      "결재 대기/진행/완료 문서 일괄 조회",
      "결재선은 직책 기반 5단계 순차 진행",
      "반려 시 사유 작성 → 작성자 알림 자동 발송",
    ],
  },
  "/verification-center": {
    title: "검증센터",
    steps: [
      "위험성평가/작업계획서의 누락·부적합 항목 자동 감지",
      "선택 적용 또는 무시 처리 (무시 사유 기록)",
      "통과해야 결재 상신 가능",
    ],
  },
  "/ai-assistant": {
    title: "AI 어시스턴트",
    steps: [
      "법령/규칙 질의, 위험요인 추천, 사고사례 검색",
      "한국 산업안전보건법 기준으로 응답",
    ],
  },
};

export function findHelp(pathname: string): HelpEntry | null {
  // exact then prefix
  if (HELP[pathname]) return HELP[pathname];
  const matched = Object.keys(HELP)
    .filter(k => k !== "/" && pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0];
  return matched ? HELP[matched] : null;
}
