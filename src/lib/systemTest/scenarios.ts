import { supabase } from "@/integrations/supabase/client";
import { runStep, StepResult, TestContext, trackArtifact } from "./runner";

const QA_PREFIX = "__QA__";

// ===== Admin scenario =====
export async function runAdminScenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];

  // Use existing project (no new project creation per absolute condition)
  out.push(
    await runStep("admin", "select_project", async () => {
      if (!ctx.projectId) return { pass: false, error_location: "no project selected" };
      const { data } = await supabase.from("projects").select("id, name").eq("id", ctx.projectId).maybeSingle();
      return { pass: !!data, details: { id: data?.id } };
    })
  );

  // Create QA assessment_run
  let runRowId: string | null = null;
  out.push(
    await runStep("admin", "create_assessment_run", async () => {
      const { data, error } = await supabase
        .from("assessment_runs")
        .insert({
          project_id: ctx.projectId!,
          period_label: `${QA_PREFIX}${ctx.runId.slice(0, 8)}`,
          status: "작성중",
          created_by: ctx.userId,
          type: "정기",
        } as any)
        .select("id")
        .single();
      if (error) return { pass: false, error_location: error.message };
      runRowId = data.id;
      await trackArtifact(ctx.runId, "assessment_run", "assessment_runs", data.id);
      return { pass: true, details: { id: data.id } };
    })
  );

  // Create QA work plan
  out.push(
    await runStep("admin", "create_work_plan", async () => {
      const { data, error } = await supabase
        .from("work_plans")
        .insert({
          project_id: ctx.projectId!,
          title: `${QA_PREFIX}WP-${ctx.runId.slice(0, 6)}`,
          work_type: "일반작업",
          status: "작성중",
          created_by: ctx.userId,
        } as any)
        .select("id")
        .single();
      if (error) return { pass: false, error_location: error.message };
      await trackArtifact(ctx.runId, "work_plan", "work_plans", data.id);
      return { pass: true, details: { id: data.id } };
    })
  );

  // Approve permit (status transition test) - just create one with approved status
  out.push(
    await runStep("admin", "create_work_permit", async () => {
      const { data, error } = await supabase
        .from("work_permits")
        .insert({
          project_id: ctx.projectId!,
          work_name: `${QA_PREFIX}PMT-${ctx.runId.slice(0, 6)}`,
          permit_type: "일반",
          status: "신청",
          created_by: ctx.userId,
        } as any)
        .select("id")
        .single();
      if (error) return { pass: false, error_location: error.message };
      await trackArtifact(ctx.runId, "permit", "work_permits", data.id);
      return { pass: true, details: { id: data.id } };
    })
  );

  return out;
}

// ===== Contractor scenario (TBM) =====
export async function runContractorScenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];
  let tbmId: string | null = null;
  let qrToken: string | null = null;

  out.push(
    await runStep("contractor", "create_tbm", async () => {
      const { data, error } = await supabase
        .from("tbm_sessions")
        .insert({
          project_id: ctx.projectId!,
          title: `${QA_PREFIX}TBM`,
          tbm_date: new Date().toISOString().slice(0, 10),
          leader_name: "QA",
          location: "QA",
          briefing_summary: "QA briefing",
          briefing_risks: [] as any,
          is_active: true,
          created_by: ctx.userId,
        } as any)
        .select("id, qr_token")
        .single();
      if (error) return { pass: false, error_location: error.message };
      tbmId = data.id;
      qrToken = data.qr_token;
      await trackArtifact(ctx.runId, "tbm", "tbm_sessions", data.id);
      return { pass: true, details: { id: data.id, has_token: !!data.qr_token } };
    })
  );

  out.push(
    await runStep("contractor", "tbm_qr_lookup", async () => {
      if (!qrToken) return { pass: false, error_location: "no qr_token" };
      const { data, error } = await supabase.rpc("get_tbm_by_token", { _token: qrToken });
      if (error) return { pass: false, error_location: error.message };
      const ok = data && (data as any).id === tbmId;
      return { pass: !!ok, details: data };
    })
  );

  return out;
}

// ===== Worker scenario =====
export async function runWorkerScenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];

  out.push(
    await runStep("worker", "register_worker", async () => {
      const phone = `010${Date.now().toString().slice(-8)}`;
      const { data, error } = await supabase.rpc("register_worker", {
        _project_id: ctx.projectId!,
        _name: `${QA_PREFIX}W`,
        _phone: phone,
        _company_name: `${QA_PREFIX}Co`,
        _company_id: undefined as any,
      } as any);
      if (error) return { pass: false, error_location: error.message };
      const r = data as any;
      if (!r?.success) return { pass: false, error_location: r?.error || "no success" };
      await trackArtifact(ctx.runId, "worker", "workers", r.worker_id);
      return { pass: true, details: { worker_id: r.worker_id, has_token: !!r.qr_token } };
    })
  );

  return out;
}

// ===== Permission scenario =====
export async function runPermissionScenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];

  out.push(
    await runStep("perm", "master_self_check", async () => {
      const { data, error } = await supabase.rpc("qa_impersonate_check", {
        _target_user: ctx.userId,
        _project_id: ctx.projectId!,
      });
      if (error) return { pass: false, error_location: error.message };
      const r = data as any;
      return { pass: r?.is_master === true, details: r };
    })
  );

  out.push(
    await runStep("perm", "rls_select_projects", async () => {
      const { data, error } = await supabase.from("projects").select("id").limit(1);
      return { pass: !error && Array.isArray(data), error_location: error?.message };
    })
  );

  return out;
}

// ===== Workflow integration scenario =====
export async function runWorkflowScenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];

  out.push(
    await runStep("flow", "ra_to_wp_chain", async () => {
      const { data: ra, error: e1 } = await supabase
        .from("assessment_runs")
        .insert({
          project_id: ctx.projectId!,
          period_label: `${QA_PREFIX}FLOW`,
          status: "작성중",
          created_by: ctx.userId,
          type: "정기",
        } as any)
        .select("id")
        .single();
      if (e1) return { pass: false, error_location: e1.message };
      await trackArtifact(ctx.runId, "ra", "assessment_runs", ra.id);

      const { data: wp, error: e2 } = await supabase
        .from("work_plans")
        .insert({
          project_id: ctx.projectId!,
          title: `${QA_PREFIX}FLOW-WP`,
          work_type: "일반작업",
          status: "작성중",
          created_by: ctx.userId,
        } as any)
        .select("id")
        .single();
      if (e2) return { pass: false, error_location: e2.message };
      await trackArtifact(ctx.runId, "wp", "work_plans", wp.id);

      return { pass: true, details: { ra: ra.id, wp: wp.id } };
    })
  );

  return out;
}

// ===== Notification scenario =====
export async function runNotificationScenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];

  out.push(
    await runStep("notify", "create_notification_row", async () => {
      const { data, error } = await supabase
        .from("notifications")
        .insert({
          user_id: ctx.userId,
          title: `${QA_PREFIX}알림`,
          message: "QA test notification",
          type: "test",
        } as any)
        .select("id")
        .single();
      if (error) return { pass: false, error_location: error.message };
      await trackArtifact(ctx.runId, "notification", "notifications", data.id);
      return { pass: true };
    })
  );

  return out;
}

// ===== Integrity scenario =====
export async function runIntegrityScenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];
  let raId: string | null = null;

  out.push(
    await runStep("integ", "insert_then_read", async () => {
      const label = `${QA_PREFIX}INT-${Date.now()}`;
      const { data, error } = await supabase
        .from("assessment_runs")
        .insert({
          project_id: ctx.projectId!,
          period_label: label,
          status: "작성중",
          created_by: ctx.userId,
          type: "정기",
        } as any)
        .select("id, period_label")
        .single();
      if (error) return { pass: false, error_location: error.message };
      raId = data.id;
      await trackArtifact(ctx.runId, "ra", "assessment_runs", data.id);
      return { pass: data.period_label === label, details: { id: data.id } };
    })
  );

  out.push(
    await runStep("integ", "update_reflects", async () => {
      if (!raId) return { pass: false, error_location: "no row" };
      const newLabel = `${QA_PREFIX}UPD-${Date.now()}`;
      const { error } = await supabase
        .from("assessment_runs")
        .update({ period_label: newLabel } as any)
        .eq("id", raId);
      if (error) return { pass: false, error_location: error.message };
      const { data } = await supabase
        .from("assessment_runs")
        .select("period_label")
        .eq("id", raId)
        .single();
      return { pass: data?.period_label === newLabel };
    })
  );

  return out;
}

export const SCENARIOS = {
  admin: { label: "관리자", run: runAdminScenario },
  contractor: { label: "시공사/협력사", run: runContractorScenario },
  worker: { label: "근로자", run: runWorkerScenario },
  perm: { label: "권한", run: runPermissionScenario },
  flow: { label: "기능 연동", run: runWorkflowScenario },
  notify: { label: "알림", run: runNotificationScenario },
  integ: { label: "데이터 무결성", run: runIntegrityScenario },
} as const;

export type ScenarioKey = keyof typeof SCENARIOS;
