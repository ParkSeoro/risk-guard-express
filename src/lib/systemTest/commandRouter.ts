// ================================================================
// Feature command router — "특정 기능만 테스트" 자유 텍스트 명령 처리
// ----------------------------------------------------------------
// 마스터가 "TBM 카메라" / "근로자 등록" / "/m/inspect" 같이 입력하면
// 매칭되는 시나리오 키 또는 step_key 들을 골라서 실행한다.
// ================================================================

import { SCENARIOS, ScenarioKey } from "./scenarios";
import { MOBILE_ROUTES } from "./mobileScenarios";
import { StepResult, TestContext } from "./runner";

// 키워드 → 시나리오 키
const KEYWORD_MAP: Array<{ patterns: RegExp[]; keys: ScenarioKey[] }> = [
  { patterns: [/모바일|mobile|\/m\b|\/m\//i], keys: ["mobile"] },
  { patterns: [/카메라|camera|qr.*스캔|스캔/i], keys: ["mobile"] },
  { patterns: [/관리자|admin/i], keys: ["admin"] },
  { patterns: [/시공사|협력사|contractor/i], keys: ["contractor"] },
  { patterns: [/근로자|worker(?!.*로그)/i], keys: ["worker", "mobile"] },
  { patterns: [/권한|role|rls|perm/i], keys: ["perm"] },
  { patterns: [/연동|workflow|flow|체인|chain/i], keys: ["flow", "e2e"] },
  { patterns: [/알림|notification|notify/i], keys: ["notify"] },
  { patterns: [/무결성|integrity/i], keys: ["integ"] },
  { patterns: [/스키마|schema|drift|컬럼/i], keys: ["schema", "drift"] },
  { patterns: [/rpc|함수|function/i], keys: ["rpc", "drift"] },
  { patterns: [/엣지|edge|edgefn/i], keys: ["edgefn"] },
  { patterns: [/감사|audit/i], keys: ["audit"] },
  { patterns: [/위험성평가|위험|ra|assessment/i], keys: ["admin", "flow", "e2e"] },
  { patterns: [/작업계획|wp|work.?plan/i], keys: ["admin", "flow", "e2e"] },
  { patterns: [/허가|permit/i], keys: ["admin", "flow", "e2e"] },
  { patterns: [/tbm/i], keys: ["contractor", "e2e", "mobile"] },
  { patterns: [/입퇴장|입장|퇴장|attendance|entry/i], keys: ["e2e", "mobile"] },
  { patterns: [/전체|all|모두/i], keys: Object.keys(SCENARIOS) as ScenarioKey[] },
];

export type CommandPlan = {
  matched: boolean;
  scenarios: ScenarioKey[];
  // 선택적으로, 특정 시나리오 안에서 step_key 키워드로도 추가 필터링
  stepFilter?: (s: StepResult) => boolean;
  reason: string;
};

export function planCommand(input: string): CommandPlan {
  const q = (input || "").trim();
  if (!q) return { matched: false, scenarios: [], reason: "빈 명령" };

  // 0) 라우트 직접 입력 (예: /m/inspect)
  const routeHit = MOBILE_ROUTES.find((r) => q.toLowerCase().includes(r.path.toLowerCase()));
  if (routeHit) {
    const filterKey = `route_${routeHit.path.replace(/[^a-zA-Z0-9]/g, "_")}`.slice(0, 60);
    return {
      matched: true,
      scenarios: ["mobile"],
      stepFilter: (s) =>
        s.scenario_key === "mobile" &&
        (s.step_key === filterKey ||
          ["secure_context", "service_worker", "selected_project_id", "storage_attachments_bucket"].includes(s.step_key)),
      reason: `라우트 ${routeHit.path} (${routeHit.label}) 단독 검증`,
    };
  }

  // 1) 시나리오 키 직접 (admin / mobile / e2e ...)
  const direct = (Object.keys(SCENARIOS) as ScenarioKey[]).find(
    (k) => k.toLowerCase() === q.toLowerCase() || SCENARIOS[k].label === q
  );
  if (direct) {
    return { matched: true, scenarios: [direct], reason: `시나리오 ${SCENARIOS[direct].label} 단독 실행` };
  }

  // 2) 키워드 매핑 누적
  const picked = new Set<ScenarioKey>();
  const matchedPatterns: string[] = [];
  for (const m of KEYWORD_MAP) {
    if (m.patterns.some((p) => p.test(q))) {
      m.keys.forEach((k) => picked.add(k));
      matchedPatterns.push(m.patterns[0].source);
    }
  }

  if (picked.size === 0) {
    return { matched: false, scenarios: [], reason: `매칭된 시나리오 없음: "${q}"` };
  }

  return {
    matched: true,
    scenarios: Array.from(picked),
    reason: `키워드 매칭 → ${Array.from(picked).map((k) => SCENARIOS[k].label).join(", ")}`,
  };
}

export function applyStepFilter(results: StepResult[], plan: CommandPlan): StepResult[] {
  if (!plan.stepFilter) return results;
  return results.filter(plan.stepFilter);
}

// 디버그용: 어떤 명령들이 인식되는지 사용자에게 보여줄 힌트
export const COMMAND_HINTS = [
  "모바일 전체",
  "카메라",
  "TBM",
  "근로자 등록",
  "/m/inspect",
  "/m/scan",
  "/m/permits",
  "위험성평가",
  "권한",
  "엣지 함수",
  "알림",
  "전체",
];
