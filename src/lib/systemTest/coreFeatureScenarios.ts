/**
 * Core 12 Feature Smoke Scenarios
 *
 * 품질 심화 스프린트의 코어 12개 기능에 대한 "최소 1개 E2E 스텁".
 * 각 기능 카드(`docs/feature-cards/*.md`)가 8체크리스트를 채워나가면서
 * 여기에 더 깊은 단계가 추가됩니다. 현재는 매 배포 전 회귀 그물의
 * 첫 매듭으로 "테이블 존재 + 프로젝트 스코프 SELECT 가능" 을 보장합니다.
 */
import { supabase } from "@/integrations/supabase/client";
import { runStep, StepResult, TestContext } from "./runner";

type CoreCheck = {
  feature: string;
  table: string;
  scoped?: boolean; // true → filter by project_id
};

const CORE_12: CoreCheck[] = [
  { feature: "risk_assessment", table: "assessment_runs", scoped: true },
  { feature: "work_plan", table: "work_plans", scoped: true },
  { feature: "work_permit", table: "work_permits", scoped: true },
  { feature: "tbm", table: "tbm_sessions", scoped: true },
  { feature: "approvals", table: "approvals", scoped: true },
  { feature: "incidents", table: "incident_reports", scoped: true },
  { feature: "emergency_drills", table: "emergency_drills", scoped: true },
  { feature: "safety_cost", table: "safety_cost_items", scoped: true },
  { feature: "worker_qr", table: "worker_daily_qr", scoped: true },
  { feature: "education_mapping", table: "worker_legal_education_mapping", scoped: false },
  { feature: "inspections", table: "safety_inspections", scoped: true },
  { feature: "work_stop", table: "work_stop_requests", scoped: true },
];

export async function runCore12Scenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];
  for (const c of CORE_12) {
    out.push(
      await runStep("core12", `${c.feature}_smoke`, async () => {
        let q: any = supabase.from(c.table as any).select("id", { count: "exact", head: true });
        if (c.scoped && ctx.projectId) q = q.eq("project_id", ctx.projectId);
        const { error, count } = await q;
        if (error) {
          // System Test Engine runs as master — schema/RLS/server errors are all FAIL.
          return {
            pass: false,
            error_location: `${c.table}: ${error.message}`,
            details: { table: c.table, code: error.code ?? null },
          };
        }
        return { pass: true, details: { table: c.table, rows: count ?? 0 } };
      })
    );
  }
  return out;
}
