/**
 * Public /manual copy. Code is SSOT — do not invent gates that are not in the repo.
 */
import type { ManualAudience } from "@/lib/manualAudience";
import { audienceIncludes } from "@/lib/manualAudience";

export type { ManualAudience };

export type ManualSection = {
  id: string;
  audience: ManualAudience[];
  icon: string;
  title: string;
  keywords: string[];
  bullets: string[];
  showMatrix?: boolean;
};

export type ManualFaq = {
  id: string;
  q: string;
  a: string;
  audience: ManualAudience[];
  keywords: string[];
  /** Repo path this answer was read from — tests assert these stay honest. */
  source: string;
};

export type ManualTerm = {
  term: string;
  plain: string;
};

export type ManualFlowStep = {
  n: string;
  title: string;
  desc: string;
};

export const MANUAL_QUICK_SEARCH = [
  "GPS",
  "출근",
  "로그인",
  "결재",
  "상신",
  "작업중지",
  "가능성",
  "TBM",
  "허가서",
];

export const ALL_AUDIENCES: ManualAudience[] = ["worker", "supervisor", "admin"];

export const WORKER_DAY_STEPS: ManualFlowStep[] = [
  { n: "1", title: "출근", desc: "현장 안에 있으면 출근이 열립니다. 오늘 작업·위험을 읽고 서명하세요." },
  { n: "2", title: "TBM 확인", desc: "오늘 브리핑을 확인하고, 보호구를 챙깁니다." },
  { n: "3", title: "작업", desc: "안내된 작업을 합니다. 위험하면 작업중지를 누를 수 있습니다." },
  { n: "4", title: "퇴근", desc: "무재해·건강을 확인하고 서명하면 퇴근이 기록됩니다." },
];

export const ADMIN_FLOW_STEPS: ManualFlowStep[] = [
  { n: "1", title: "위험성평가", desc: "관리감독자가 작성·상신" },
  { n: "2", title: "작업계획서", desc: "법정 양식·첨부 후 결재" },
  { n: "3", title: "작업허가서", desc: "평가·계획과 연결" },
  { n: "4", title: "TBM", desc: "당일 브리핑·서명" },
  { n: "5", title: "작업", desc: "현장 적용 체크" },
  { n: "6", title: "점검/조치", desc: "부적합 → 조치" },
  { n: "7", title: "사고 대응", desc: "사고·훈련·중지" },
  { n: "8", title: "비용 정산", desc: "산업안전보건관리비" },
];

export const SUPERVISOR_FLOW_STEPS: ManualFlowStep[] = [
  { n: "1", title: "작성 주체", desc: "위험성평가 작성자는 관리감독자" },
  { n: "2", title: "항목 작성", desc: "개선대책·보호구·법적근거" },
  { n: "3", title: "근로자 의견", desc: "참여 탭에서 의견 등록" },
  { n: "4", title: "결재 상신", desc: "작성 본인만 상신" },
];

export const MANUAL_SECTIONS: ManualSection[] = [
  {
    id: "worker-day",
    audience: ["worker"],
    icon: "HardHat",
    title: "오늘 하루",
    keywords: ["출근", "퇴근", "오늘", "서명", "GPS"],
    bullets: [
      "앱 하단의 「오늘」이 하루 화면입니다. 왼쪽 메뉴가 아닙니다.",
      "현장 펜스 안에 있어야 출근 버튼이 열립니다. 현장 밖에서는 출근할 수 없습니다.",
      "출근은 자동으로 찍히지 않습니다. 오늘 작업·위험을 확인하고 손으로 서명해야 입장으로 기록됩니다.",
      "퇴근은 무재해 확인과 건강 확인, 서명이 있어야 끝납니다.",
    ],
  },
  {
    id: "worker-tabs",
    audience: ["worker"],
    icon: "ClipboardList",
    title: "하단 탭",
    keywords: ["오늘", "할 일", "자료", "알림", "더보기"],
    bullets: [
      "오늘 — 출근·퇴근과 오늘 확인 서명",
      "할 일 — 내 조치, TBM, 사고 신고, 작업중지, 건강로그, 보호구 수령",
      "자료 — 승인된 위험성평가·허가서·계획서 읽기",
      "알림 — 공지·위험구역·공유 확인",
      "더보기 — 계정, QR 스캔, 위치·GPS, 사용 설명서",
    ],
  },
  {
    id: "worker-gps",
    audience: ["worker"],
    icon: "Map",
    title: "GPS가 하는 일",
    keywords: ["GPS", "위치", "출근", "현장"],
    bullets: [
      "현장에 들어와 있으면 출근이 열리고, 현장 밖이면 열리지 않습니다.",
      "출근 뒤에야 위치 추적이 시작됩니다. 출근 전에는 「GPS 출근 전」으로 보입니다.",
      "Android는 화면을 꺼도 약 3분마다 위치를 올립니다. 아이폰은 위치를 「항상」으로 두세요. 브라우저는 앱을 켠 동안만 추적합니다.",
    ],
  },
  {
    id: "worker-zone",
    audience: ["worker"],
    icon: "ShieldAlert",
    title: "위험구역 경고",
    keywords: ["위험구역", "지오펜스", "완충대", "사이렌"],
    bullets: [
      "위험구역에 들어가면 사이렌 알림이 옵니다. 이 알림은 끌 수 없습니다.",
      "경고가 뜨면 구역 밖으로 나오세요. 관리자에게 알리고, 위험하면 작업중지를 누르세요.",
      "구역 바로 바깥 약 25m는 완충대입니다. 「근처」로 보일 수 있습니다.",
    ],
  },
  {
    id: "work-stop",
    audience: ALL_AUDIENCES,
    icon: "OctagonAlert",
    title: "작업중지권",
    keywords: ["작업중지", "작업중지권", "익명", "제52조"],
    bullets: [
      "산업안전보건법 제52조 — 급박한 위험이 있으면 작업을 멈출 수 있고, 그 이유로 불이익을 주면 안 됩니다.",
      "근로자 앱 「할 일 → 작업중지권」에서 익명 또는 실명으로 접수합니다. 현장 사진 최대 3장.",
      "관리자 화면 이름은 「작업중지권」입니다. 접수·확인중 건을 처리합니다.",
    ],
  },
  {
    id: "worker-qr",
    audience: ["worker"],
    icon: "QrCode",
    title: "QR은 언제 쓰나",
    keywords: ["QR", "가입", "등록", "스캔"],
    bullets: [
      "매일 출근의 주 경로는 GPS입니다. 등록 QR은 가입용이고 매일 출근용이 아닙니다.",
      "현장 등록 QR은 처음 가입할 때 씁니다. 스캔하면 회사가 자동으로 붙고, 승인 없이 바로 쓸 수 있습니다.",
      "TBM QR은 선택입니다. 출근 서명이 당일 TBM 참여 서명으로 붙는 경우가 많습니다.",
    ],
  },
  {
    id: "supervisor-ra",
    audience: ["supervisor", "admin"],
    icon: "ShieldAlert",
    title: "위험성평가",
    keywords: ["위험성평가", "관리감독자", "가능성", "중대성", "상", "중", "하", "잔여", "개선후"],
    showMatrix: true,
    bullets: [
      "작성 주체는 관리감독자입니다. 안전관리자는 보좌 입력만 하고, 상신은 지정된 관리감독자 본인만 합니다. 감리는 열람입니다.",
      "등급은 3×3입니다. 축은 가능성 × 중대성입니다.",
      "등급 이름은 상 / 중 / 하 입니다.",
      "개선후(잔여) 등급이 따로 있습니다. 대책은 가능성을 한 단계 낮추고 중대성은 유지합니다. 전부 하로 바꾸지 않습니다.",
      "상신 전에 항목 1건 이상, 개선대책·PPE·(중·상) 법적근거, 근로자 의견, AI 항목 검토, 결재선 저장이 필요합니다.",
    ],
  },
  {
    id: "supervisor-permit",
    audience: ["supervisor", "admin"],
    icon: "FileSignature",
    title: "작업허가서",
    keywords: ["작업허가서", "화기", "밀폐", "고소", "굴착"],
    bullets: [
      "사이드바 이름은 「작업허가서」입니다. 위험성평가·작업계획서와 연결합니다.",
      "허가 승인 뒤에도 TBM·교육·입장(출근 서명)이 맞아야 현장 적용으로 봅니다.",
      "TBM 참여 서명은 근로자 출근 서명으로 붙을 수 있습니다. QR은 선택입니다.",
    ],
  },
  {
    id: "supervisor-tbm",
    audience: ["supervisor", "admin"],
    icon: "QrCode",
    title: "TBM 일지",
    keywords: ["TBM", "일지", "브리핑", "서명"],
    bullets: [
      "사이드바 이름은 「TBM 일지」입니다. 허가서가 나오면 당일 TBM이 생기거나 여기서 만듭니다.",
      "실시 사진을 올리고 일지를 인쇄합니다.",
      "근로자 화면의 「할 일 → TBM 참여」와 같은 기록입니다.",
    ],
  },
  {
    id: "supervisor-opinion",
    audience: ["supervisor"],
    icon: "Users",
    title: "근로자 의견 수렴",
    keywords: ["근로자 의견", "참여", "보건"],
    bullets: [
      "위험성평가 상신에 근로자 의견 1건 이상이 필요할 수 있습니다. 참여 탭에서 등록합니다.",
      "보건 유해요인이 필요한 회차도 같은 참여 탭에서 받습니다.",
      "AI가 만든 항목은 검토를 끝내야 상신됩니다.",
    ],
  },
  {
    id: "approvals",
    audience: ["admin", "supervisor"],
    icon: "FileCheck",
    title: "전자결재",
    keywords: ["전자결재", "상신", "반려", "재상신", "결재선"],
    bullets: [
      "사이드바 이름은 「전자결재」입니다. 위험성평가·계획서·허가서·산업안전보건관리비 등이 여기를 지납니다.",
      "결재선은 저장해야 상신됩니다. 화면에만 두고 저장하지 않으면 막힙니다.",
      "반려되면 기안자와 이미 승인한 앞단계만 결과를 받습니다. 아직 순서가 안 온 윗단계에는 가지 않습니다.",
      "수정 후 재상신하면 버전이 올라갑니다. 승인된 문서는 함부로 고치지 않습니다.",
    ],
  },
  {
    id: "work-plans",
    audience: ["admin"],
    icon: "FileText",
    title: "작업계획서",
    keywords: ["작업계획서", "첨부", "교육자료"],
    bullets: [
      "사이드바 이름은 「작업계획서」입니다. 법정 양식과 필수 첨부가 있습니다.",
      "필수 첨부가 빠지면 결재 상신이 막힙니다.",
      "교육자료 자동생성을 켜 두면 승인 뒤 TBM 자료로 이어질 수 있습니다.",
    ],
  },
  {
    id: "site-ready",
    audience: ["admin"],
    icon: "ClipboardList",
    title: "현장 적용 체크",
    keywords: ["현장 적용 체크", "작업 시작", "교육"],
    bullets: [
      "사이드바 이름은 「현장 적용 체크」입니다.",
      "허가 승인, 교육 확인, TBM 참여, 입장(출근)이 맞는지 한곳에서 봅니다.",
      "조건이 비면 작업 시작으로 보지 않습니다.",
    ],
  },
  {
    id: "workers",
    audience: ["admin"],
    icon: "HardHat",
    title: "근로자 관리",
    keywords: ["근로자 관리", "명부", "입퇴장", "QR"],
    bullets: [
      "사이드바는 「근로자 관리」 한 칸입니다. 명부와 입퇴장 현황은 그 안 탭입니다.",
      "회사별 등록 QR을 만들어 현장에 붙입니다. 근로자가 스캔하면 소속이 붙고 바로 활성화됩니다.",
      "매일 출입의 기준은 앱 GPS 출근입니다. 레거시 일일 QR 탭은 없습니다.",
    ],
  },
  {
    id: "education",
    audience: ["admin"],
    icon: "GraduationCap",
    title: "교육·선임",
    keywords: ["안전보건교육 이수", "교육자료", "공개 자료실", "안전관리자 선임"],
    bullets: [
      "안전보건교육 이수 — 근로자 교육 기록",
      "교육자료 · 공개 자료실 — 현장 배포 자료",
      "안전관리자 선임 — 선임 현황",
    ],
  },
  {
    id: "inspect",
    audience: ["admin"],
    icon: "ClipboardCheck",
    title: "안전점검",
    keywords: ["안전점검", "부적합", "조치", "감독 대응"],
    bullets: [
      "사이드바 이름은 「안전점검」입니다. 항목별 적합/부적합과 사진을 남깁니다.",
      "부적합이면 담당자에게 알림이 가고 조치가 생깁니다.",
      "「감독 대응(점검모드)」는 점검 대응용 화면입니다.",
    ],
  },
  {
    id: "incidents",
    audience: ["admin"],
    icon: "AlertOctagon",
    title: "사고 관리 · 비상대피훈련",
    keywords: ["사고 관리", "비상대피훈련", "아차"],
    bullets: [
      "사고 관리 — 아차·경미·중대 보고. 중대재해 알림은 끌 수 없습니다.",
      "비상대피훈련 — 훈련 기록과 알림",
    ],
  },
  {
    id: "location",
    audience: ["admin"],
    icon: "Map",
    title: "위치 · 관제",
    keywords: ["통합 현장 관제맵", "구역 출입 모니터링", "근로자 분포", "비전 관제", "현장 일기예보"],
    bullets: [
      "통합 현장 관제맵 — 출근·구역을 한 지도에서 봅니다.",
      "구역 출입 모니터링 — 위험구역 진입 기록",
      "근로자 분포 — 누가 어디에 있는지",
      "비전 관제 — 현장 카메라 라이브. 설정은 마스터만 합니다. 시공사는 하위 협력사까지, 협력사는 자사·현장 공용만 봅니다.",
      "현장 일기예보 — 레이더·시간별 영향",
    ],
  },
  {
    id: "safety-cost",
    audience: ["admin"],
    icon: "ReceiptText",
    title: "산업안전보건관리비",
    keywords: ["산업안전보건관리비", "안관비", "증빙", "지급대장", "이관"],
    bullets: [
      "사이드바 이름은 「산업안전보건관리비」입니다. 예전에 안관비라고 부르던 서류입니다.",
      "당월 신규 작성은 항목 입력, 매일 증빙, 비목별 증빙 패키지, (3번 보호구가 있으면) 지급대장 서명이 있어야 상신됩니다.",
      "사용 불가 항목·계상금액 초과·OCR 저신뢰 사유가 남아 있으면 막힙니다.",
      "승인본 이관(최초본) 월은 항목별 증빙 패키지를 요구하지 않습니다. 지금 작성 중인 달을 이관하지 마세요.",
    ],
  },
  {
    id: "health",
    audience: ["admin"],
    icon: "HeartPulse",
    title: "보건",
    keywords: ["보건 대시보드", "건강진단", "작업환경측정", "화학물질", "MSDS", "유해요인조사", "보건교육"],
    bullets: [
      "사이드바의 입구는 「보건 대시보드」입니다. 하위 화면은 그 안에서 엽니다.",
      "건강진단 · 작업환경측정 · 화학물질/MSDS · 보건교육 · 유해요인조사",
    ],
  },
  {
    id: "alerts",
    audience: ALL_AUDIENCES,
    icon: "Bell",
    title: "알림 · 현장 공지",
    keywords: ["알림", "현장 공지", "방해금지"],
    bullets: [
      "사이드바 「알림」과 「현장 공지」입니다. 앱은 하단 「알림」과 더보기 「알림 · 알람 설정」입니다.",
      "사고·결재·위험구역·작업중지·공지·평가 공유 같은 안전 필수 알림은 채널을 꺼도, 방해금지 시간에도 갑니다.",
      "그 외 알림은 채널 끄기나 방해금지 시간(기본 22:00–07:00)에 막힐 수 있습니다.",
    ],
  },
  {
    id: "ops",
    audience: ["admin"],
    icon: "ListTodo",
    title: "운영",
    keywords: ["할 일", "프로젝트", "회사 관리", "법적업무", "협력사 안전성적표", "검증센터", "대시보드"],
    bullets: [
      "대시보드 — 현장 숫자 한눈",
      "할 일 — 기한 있는 조치",
      "프로젝트 · 회사 관리",
      "법적업무 — 법정 주기 업무",
      "협력사 안전성적표",
      "검증센터 — 서류 누락을 다시 봅니다",
    ],
  },
];

export const MANUAL_FAQS: ManualFaq[] = [
  {
    id: "login",
    q: "가입했는데 로그인이 안 돼요.",
    a: "근로자는 현장 등록 QR로 가입하면 승인 없이 바로 전화번호·PIN으로 로그인됩니다. 관리자(이메일) 가입은 승인 대기일 수 있습니다. Play에서 앱만 설치해서는 가입되지 않으니, 현장에서 받은 등록 QR을 스캔하세요.",
    audience: ALL_AUDIENCES,
    keywords: ["로그인", "가입", "승인", "QR"],
    source: "AGENTS.md worker QR signup active; manager signup pending",
  },
  {
    id: "qr-company",
    q: "QR 스캔 후 회사를 선택하는 화면이 안 나와요.",
    a: "관리자가 회사를 지정해 발급한 등록 QR입니다. 소속이 자동으로 붙으니 그대로 진행하세요. 매일 출근용 GPS와는 다른 QR입니다.",
    audience: ALL_AUDIENCES,
    keywords: ["QR", "회사", "근로자"],
    source: "src/pages/Manual.tsx legacy FAQ + WorkerDailyHome GPS primary",
  },
  {
    id: "photo",
    q: "사진 업로드가 안 됩니다.",
    a: "프로젝트 소속과 로그인 상태를 확인한 뒤 다시 시도하세요. 권한 문제가 계속되면 현장 안전관리자에게 문의하세요.",
    audience: ALL_AUDIENCES,
    keywords: ["사진", "사진 업로드", "권한"],
    source: "src/pages/Manual.tsx existing FAQ (generic storage/RLS)",
  },
  {
    id: "work-start",
    q: "작업 시작이 안 됩니다.",
    a: "현장 적용 체크와 허가서 안내는 ①허가 승인 ②교육 확인 ③TBM 참여 ④입장(출근 서명)입니다. TBM 서명은 출근 서명으로 붙을 수 있고, TBM QR은 선택입니다.",
    audience: ["supervisor", "admin"],
    keywords: ["작업", "허가", "TBM", "입장", "현장 적용"],
    source: "src/lib/helpDictionary.ts /work-permits; src/pages/SiteReadinessChecklist.tsx",
  },
  {
    id: "reject",
    q: "결재가 반려되면 어떻게 되나요?",
    a: "사유와 함께 기안자와 이미 승인한 앞단계에게만 알림이 갑니다. 아직 순서가 안 온 윗단계에는 가지 않습니다. 수정 후 재상신하면 버전이 증가합니다.",
    audience: ["supervisor", "admin"],
    keywords: ["결재", "반려", "재상신"],
    source: "HANDOFF.md 결재 알림; approval resubmission versioning",
  },
  {
    id: "gps-consent",
    q: "GPS가 「꺼짐」으로 나와요.",
    a: "위치 동의가 없습니다. 앱에서 위치 이용에 동의하면 「GPS 꺼짐」이 사라집니다.",
    audience: ALL_AUDIENCES,
    keywords: ["GPS", "동의", "꺼짐"],
    source: "src/lib/tracking/gpsStatusUi.tsx GPS_BLOCK_CHIP/HINT no_consent",
  },
  {
    id: "gps-permission",
    q: "GPS 권한이라고 나와요.",
    a: "휴대폰 위치 권한이 부족합니다. 위치는 「항상 허용」과 정확한 위치로 두세요. 아이폰은 백그라운드 추적이 항상 허용일 때만 됩니다.",
    audience: ALL_AUDIENCES,
    keywords: ["GPS", "권한", "항상"],
    source: "src/lib/tracking/gpsStatusUi.tsx GPS_BLOCK_HINT no_permission",
  },
  {
    id: "gps-checkin",
    q: "GPS 출근 전이라고 나와요.",
    a: "아직 오늘 출근(서명) 전입니다. 현장 안에서 출근을 마치면 추적이 시작됩니다. 위치만 켠다고 출근이 기록되지 않습니다.",
    audience: ALL_AUDIENCES,
    keywords: ["GPS", "출근"],
    source: "src/lib/tracking/gpsStatusUi.tsx GPS_BLOCK_HINT no_checkin",
  },
  {
    id: "gps-fence",
    q: "GPS 현장 밖이라고 나와요.",
    a: "지금 좌표가 현장 펜스 밖입니다. 현장으로 돌아오면 추적이 다시 시작됩니다. 출근 버튼도 현장 안에서만 열립니다.",
    audience: ALL_AUDIENCES,
    keywords: ["GPS", "현장 밖", "펜스"],
    source: "src/lib/tracking/gpsStatusUi.tsx GPS_BLOCK_HINT fence_probe_failed",
  },
  {
    id: "gps-identity",
    q: "GPS 신원이라고 나와요.",
    a: "명부의 근로자와 로그인 계정이 다릅니다. 관리자에게 문의해 명부·계정을 맞추세요. (코드에 있는 다섯 번째 차단 사유입니다.)",
    audience: ALL_AUDIENCES,
    keywords: ["GPS", "신원", "명부"],
    source: "src/lib/tracking/gpsStatusUi.tsx GPS_BLOCK_HINT identity_mismatch",
  },
  {
    id: "ra-preflight",
    q: "위험성평가를 상신할 수 없어요.",
    a: "작성 주체(관리감독자)가 있어야 하고, 그 본인만 상신할 수 있습니다. 항목 1건 이상, 개선대책·PPE·발생상황·기존대책, 중·상은 법적근거, 필요한 경우 근로자 의견·보건 유해요인, AI 항목 검토, 결재선 저장이 맞아야 합니다. 하 등급은 법적근거 없이도 통과합니다.",
    audience: ["supervisor", "admin"],
    keywords: ["위험성평가", "상신", "관리감독자", "결재선"],
    source: "src/lib/assessmentSubmitPreflight.ts buildAssessmentSubmitPreflight / countIncompleteAssessmentItems",
  },
  {
    id: "cost-preflight",
    q: "산업안전보건관리비 결재가 막혀요.",
    a: "월별 항목이 있어야 하고, 당월 신규는 매일 증빙·비목별 증빙 패키지·(3번 보호구 지출 시) 지급대장 서명·사용 불가 항목 제거·검토 필요 항목 확인·법적 근거·OCR 저신뢰 사유·계상금액 초과 여부가 통과해야 합니다. 이관(최초본) 월은 증빙 패키지·지급대장·OCR을 면제합니다.",
    audience: ["admin"],
    keywords: ["산업안전보건관리비", "증빙", "지급대장", "이관"],
    source: "src/pages/SafetyCost.tsx auditChecklist",
  },
  {
    id: "push-quiet",
    q: "알림이 안 와요.",
    a: "알림 · 알람 설정에서 채널을 껐거나 방해금지 시간(기본 22:00–07:00)이면 일반 알림은 안 갑니다. 사고·결재·위험구역·작업중지·공지·평가 공유·TBM 서명 요청 같은 안전 필수 유형은 설정을 무시하고 발송합니다. 폰 알림 권한과 앱 알림 설정도 확인하세요.",
    audience: ALL_AUDIENCES,
    keywords: ["알림", "푸시", "방해금지"],
    source: "supabase/migrations/20260909010000_manager_tbm_sign.sql should_push_notify; src/pages/SettingsNotifications.tsx MANDATORY_EVENTS_ALL",
  },
];

export const MANUAL_TERMS: ManualTerm[] = [
  { term: "TBM", plain: "작업 전 짧은 안전 브리핑. 일지는 「TBM 일지」, 근로자는 「TBM 참여」." },
  { term: "상신", plain: "작성한 문서를 전자결재에 올리는 일. 결재선 저장 후에만 됩니다." },
  { term: "반려", plain: "결재자가 문서를 되돌림. 기안자와 이미 승인한 앞단계만 알림을 받습니다." },
  { term: "재상신", plain: "반려·수정 뒤 다시 올리는 일. 문서 버전이 올라갑니다." },
  { term: "공종", plain: "위험성평가에서 고르는 작업 종류. 이름만 보고 위험을 만들지 않습니다." },
  { term: "가능성", plain: "위험도 3×3의 한쪽 축. 그 일이 얼마나 일어날 수 있는지. 빈도가 아닙니다." },
  { term: "중대성", plain: "위험도 3×3의 다른 축. 일어나면 얼마나 큰 피해인지. 강도가 아닙니다." },
  { term: "잔여위험(개선후)", plain: "대책을 반영한 뒤 등급. 가능성은 한 단계 낮추고 중대성은 유지합니다." },
  { term: "관리감독자", plain: "위험성평가 작성 주체(site_supervisor). 상신·인쇄는 이 사람만 합니다." },
  { term: "결재선", plain: "누가 어떤 순서로 결재하는지. 화면에만 있으면 안 되고 저장해야 상신됩니다." },
  { term: "검증센터", plain: "서류 누락을 다시 보는 화면. 사이드바 「검증센터」." },
  { term: "지오펜스(위험구역)", plain: "들어가면 경고가 나는 현장 구역. 알림 이름은 위험구역 진입입니다." },
  { term: "완충대", plain: "구역 테두리 바깥 접근띠. 기본 25m, 최댓 200m. 「근처」로 표시될 수 있습니다." },
  { term: "PPE(보호구)", plain: "안전모·안전대 등. 위험성평가 항목과 산업안전보건관리비 3번 지급대장에 나옵니다." },
  { term: "산업안전보건관리비", plain: "예전에 안관비라고 부르던 법정 비용 서류. 사이드바 이름과 같습니다." },
  { term: "작업중지권", plain: "급박한 위험에서 작업을 멈출 권리(산업안전보건법 제52조). 익명 접수도 됩니다." },
];

/** Sidebar titles that do not need a manual section (settings / diagnostics). */
export const MANUAL_SIDEBAR_EXCEPTIONS: string[] = [
  "설정",
  "사용 설명서",
  "기준정보",
  "감사 로그",
  "권한 점검",
  "위평 라이브러리",
  "데이터 정합성 (단일 기준)",
  "시스템 테스트 엔진",
  "휴지통",
  "AI 테스트 엔진",
  "AI 로그",
  "위치 추적 점검",
  "AI 어시스턴트",
  "위험성평가 공지",
];

export function manualTextMatches(query: string, ...fields: string[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f.toLowerCase().includes(q));
}

export function filterManualSections(
  query: string,
  audience: ManualAudience | null,
  searchAll: boolean,
): ManualSection[] {
  return MANUAL_SECTIONS.filter((section) => {
    if (!searchAll && audience && !audienceIncludes(audience, section.audience)) return false;
    return manualTextMatches(query, section.title, section.keywords.join(" "), section.bullets.join(" "));
  });
}

export function filterManualFaqs(
  query: string,
  audience: ManualAudience | null,
  searchAll: boolean,
): ManualFaq[] {
  return MANUAL_FAQS.filter((faq) => {
    if (!searchAll && audience && !audienceIncludes(audience, faq.audience)) return false;
    return manualTextMatches(query, faq.q, faq.a, faq.keywords.join(" "));
  });
}

export function filterManualTerms(query: string): ManualTerm[] {
  return MANUAL_TERMS.filter((term) => manualTextMatches(query, term.term, term.plain));
}

export function manualCorpusText(): string {
  return [
    ...MANUAL_SECTIONS.flatMap((s) => [s.title, ...s.keywords, ...s.bullets]),
    ...MANUAL_FAQS.flatMap((f) => [f.q, f.a, ...f.keywords]),
    ...MANUAL_TERMS.flatMap((t) => [t.term, t.plain]),
  ].join("\n");
}
