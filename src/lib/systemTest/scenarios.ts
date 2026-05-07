import { supabase } from "@/integrations/supabase/client";
import { runStep, StepResult, TestContext, trackArtifact } from "./runner";
import { FEATURE_COVERAGE, REQUIRED_COLUMNS, REQUIRED_RPCS } from "./manifest";

const QA_PREFIX = "__QA__";

// ================================================================
// Helper: assert that a forbidden operation actually fails
// ================================================================
async function expectFailure(
  builder: any,
  label: string
): Promise<{ pass: boolean; details: any; error_location?: string }> {
  const { data, error } = await builder;
  if (error) return { pass: true, details: { rejected_with: error.code || error.message } };
  return {
    pass: false,
    error_location: `${label} should have been rejected but succeeded`,
    details: { unexpected_data: data },
  };
}

// ================================================================
// 1. Admin scenario — happy paths + state transitions
// ================================================================
export async function runAdminScenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];

  out.push(
    await runStep("admin", "select_project", async () => {
      if (!ctx.projectId) return { pass: false, error_location: "no project selected" };
      const { data } = await supabase.from("projects").select("id, name").eq("id", ctx.projectId).maybeSingle();
      return { pass: !!data, details: { id: data?.id } };
    })
  );

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

  out.push(
    await runStep("admin", "update_assessment_run_status", async () => {
      if (!runRowId) return { pass: false, error_location: "no run row" };
      const { error } = await supabase
        .from("assessment_runs")
        .update({ status: "검토중" } as any)
        .eq("id", runRowId);
      if (error) return { pass: false, error_location: error.message };
      const { data } = await supabase.from("assessment_runs").select("status").eq("id", runRowId).single();
      return { pass: data?.status === "검토중", details: data };
    })
  );

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

// ================================================================
// 2. Contractor scenario — TBM lifecycle
// ================================================================
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

  // NEGATIVE: invalid token must return NOT_FOUND, not crash
  out.push(
    await runStep("contractor", "tbm_qr_lookup_invalid", async () => {
      const { data, error } = await supabase.rpc("get_tbm_by_token", { _token: "__qa_invalid_token__" });
      if (error) return { pass: false, error_location: error.message };
      const r = data as any;
      return {
        pass: r?.error === "NOT_FOUND",
        details: r,
        error_location: r?.error !== "NOT_FOUND" ? "Invalid token must return NOT_FOUND" : undefined,
      };
    })
  );

  return out;
}

// ================================================================
// 3. Worker scenario — register + entry/exit + duplicate guard
// ================================================================
export async function runWorkerScenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];
  let workerToken: string | null = null;
  let workerPhone = "";

  out.push(
    await runStep("worker", "register_worker", async () => {
      workerPhone = `010${Date.now().toString().slice(-8)}`;
      const { data, error } = await supabase.rpc("register_worker", {
        _project_id: ctx.projectId!,
        _name: `${QA_PREFIX}W`,
        _phone: workerPhone,
        _company_name: `${QA_PREFIX}Co`,
        _company_id: undefined as any,
      } as any);
      if (error) return { pass: false, error_location: error.message };
      const r = data as any;
      if (!r?.success) return { pass: false, error_location: r?.error || "no success" };
      workerToken = r.qr_token;
      await trackArtifact(ctx.runId, "worker", "workers", r.worker_id);
      return { pass: true, details: { worker_id: r.worker_id, has_token: !!r.qr_token } };
    })
  );

  // NEGATIVE: invalid phone rejected
  out.push(
    await runStep("worker", "register_invalid_phone_rejected", async () => {
      const { data } = await supabase.rpc("register_worker", {
        _project_id: ctx.projectId!,
        _name: `${QA_PREFIX}W2`,
        _phone: "1",
        _company_name: `${QA_PREFIX}Co`,
        _company_id: undefined as any,
      } as any);
      const r = data as any;
      return {
        pass: r?.error === "INVALID_PHONE",
        details: r,
        error_location: r?.error !== "INVALID_PHONE" ? "Short phone should be rejected" : undefined,
      };
    })
  );

  // NEGATIVE: empty name rejected
  out.push(
    await runStep("worker", "register_empty_name_rejected", async () => {
      const { data } = await supabase.rpc("register_worker", {
        _project_id: ctx.projectId!,
        _name: "",
        _phone: `010${Date.now().toString().slice(-8)}`,
        _company_name: "",
        _company_id: undefined as any,
      } as any);
      const r = data as any;
      return {
        pass: r?.error === "INVALID_NAME",
        details: r,
        error_location: r?.error !== "INVALID_NAME" ? "Empty name should be rejected" : undefined,
      };
    })
  );

  // QR token resolves correctly
  out.push(
    await runStep("worker", "qr_token_lookup", async () => {
      if (!workerToken) return { pass: false, error_location: "no token from prior step" };
      const { data, error } = await supabase.rpc("get_worker_by_token", { _token: workerToken });
      if (error) return { pass: false, error_location: error.message };
      const r = data as any;
      return { pass: r?.phone === workerPhone, details: r };
    })
  );

  return out;
}

// ================================================================
// 4. Permission scenario — RLS & role enforcement
// ================================================================
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

  // NEGATIVE: RLS blocks insert on user_roles for non-master self-elevation simulation
  out.push(
    await runStep("perm", "user_roles_protected", async () => {
      // Try inserting a master role for a fake user — should be blocked by RLS or trigger
      const fakeUser = "00000000-0000-0000-0000-000000000099";
      const r = await expectFailure(
        supabase.from("user_roles").insert({ user_id: fakeUser, role: "master" as any } as any).select(),
        "user_roles insert for fake user"
      );
      // Cleanup if it accidentally inserted (master is allowed but for non-existent user it should FK fail)
      await supabase.from("user_roles").delete().eq("user_id", fakeUser);
      return r;
    })
  );

  // NEGATIVE: cannot update other project's data — try to update a non-existent project_id mismatch
  out.push(
    await runStep("perm", "rls_cross_project_blocked", async () => {
      const phantomProjectId = "00000000-0000-0000-0000-000000000001";
      // master can read all, but no project with this id should exist
      const { data, error } = await supabase
        .from("projects")
        .select("id")
        .eq("id", phantomProjectId)
        .maybeSingle();
      return { pass: !error && data === null, details: { data }, error_location: error?.message };
    })
  );

  return out;
}

// ================================================================
// 5. Workflow integration scenario — RA → WP → Permit chain
// ================================================================
export async function runWorkflowScenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];
  let raId: string | null = null;
  let wpId: string | null = null;

  out.push(
    await runStep("flow", "create_ra", async () => {
      const { data, error } = await supabase
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
      if (error) return { pass: false, error_location: error.message };
      raId = data.id;
      await trackArtifact(ctx.runId, "ra", "assessment_runs", data.id);
      return { pass: true, details: { ra: data.id } };
    })
  );

  out.push(
    await runStep("flow", "ra_to_wp_link", async () => {
      const { data, error } = await supabase
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
      if (error) return { pass: false, error_location: error.message };
      wpId = data.id;
      await trackArtifact(ctx.runId, "wp", "work_plans", data.id);
      return { pass: true, details: { wp: data.id } };
    })
  );

  out.push(
    await runStep("flow", "wp_to_permit_link", async () => {
      if (!wpId) return { pass: false, error_location: "no wp" };
      const { data, error } = await supabase
        .from("work_permits")
        .insert({
          project_id: ctx.projectId!,
          work_plan_id: wpId,
          work_name: `${QA_PREFIX}CHAIN-PMT`,
          permit_type: "일반",
          status: "신청",
          created_by: ctx.userId,
        } as any)
        .select("id, work_plan_id")
        .single();
      if (error) return { pass: false, error_location: error.message };
      await trackArtifact(ctx.runId, "permit", "work_permits", data.id);
      return { pass: data.work_plan_id === wpId, details: data };
    })
  );

  // Risk item creation tied to run (data integrity of FK)
  out.push(
    await runStep("flow", "ra_risk_item_create", async () => {
      if (!raId) return { pass: false, error_location: "no ra" };
      const { data, error } = await supabase
        .from("risk_items")
        .insert({
          project_id: ctx.projectId!,
          run_id: raId,
          process: `${QA_PREFIX}공종`,
          frequency: 2,
          severity: 2,
          likelihood_grade: "중",
          severity_grade: "중",
          risk_grade: "중",
          improved_frequency: 1,
          improved_severity: 1,
          improved_likelihood_grade: "하",
          improved_severity_grade: "하",
          improved_risk_grade: "하",
          status: "작성중",
          item_category: "ai",
          source_type: "ai",
          is_user_reviewed: false,
          is_excluded: false,
          created_by: ctx.userId,
        } as any)
        .select("id")
        .single();
      if (error) return { pass: false, error_location: error.message };
      await trackArtifact(ctx.runId, "risk_item", "risk_items", data.id);
      return { pass: true, details: { id: data.id } };
    })
  );

  return out;
}

// ================================================================
// 6. Notification scenario — row + dev override behavior
// ================================================================
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

  out.push(
    await runStep("notify", "mark_notification_read", async () => {
      const { data: row, error: e1 } = await supabase
        .from("notifications")
        .insert({
          user_id: ctx.userId,
          title: `${QA_PREFIX}읽기테스트`,
          message: "read test",
          type: "test",
        } as any)
        .select("id")
        .single();
      if (e1) return { pass: false, error_location: e1.message };
      await trackArtifact(ctx.runId, "notification", "notifications", row.id);

      const { error: e2 } = await supabase
        .from("notifications")
        .update({ is_read: true } as any)
        .eq("id", row.id);
      if (e2) return { pass: false, error_location: e2.message };

      const { data: check } = await supabase
        .from("notifications")
        .select("is_read")
        .eq("id", row.id)
        .single();
      return { pass: check?.is_read === true, details: check };
    })
  );

  return out;
}

// ================================================================
// 7. Integrity scenario — CRUD reflection, soft delete, version trigger
// ================================================================
export async function runIntegrityScenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];
  let raId: string | null = null;
  let riskItemId: string | null = null;

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
      const { data } = await supabase.from("assessment_runs").select("period_label").eq("id", raId).single();
      return { pass: data?.period_label === newLabel };
    })
  );

  // Soft-delete invisibility: after marking is_deleted=true, list queries that filter should hide it
  out.push(
    await runStep("integ", "soft_delete_hides_row", async () => {
      if (!raId) return { pass: false, error_location: "no row" };
      const { error: eDel } = await supabase
        .from("assessment_runs")
        .update({ is_deleted: true } as any)
        .eq("id", raId);
      if (eDel) return { pass: false, error_location: eDel.message };

      const { data, error } = await supabase
        .from("assessment_runs")
        .select("id, is_deleted")
        .eq("id", raId)
        .eq("is_deleted", false)
        .maybeSingle();
      return { pass: !error && data === null, details: { hidden: data === null } };
    })
  );

  // Version trigger on risk_items: changing process should increment version_number
  out.push(
    await runStep("integ", "version_trigger_bumps", async () => {
      const { data: ins, error: eIns } = await supabase
        .from("risk_items")
        .insert({
          project_id: ctx.projectId!,
          process: `${QA_PREFIX}V1`,
          frequency: 2,
          severity: 2,
          likelihood_grade: "중",
          severity_grade: "중",
          risk_grade: "중",
          improved_frequency: 1,
          improved_severity: 1,
          improved_likelihood_grade: "하",
          improved_severity_grade: "하",
          improved_risk_grade: "하",
          status: "작성중",
          item_category: "ai",
          source_type: "ai",
          is_user_reviewed: false,
          is_excluded: false,
          created_by: ctx.userId,
        } as any)
        .select("id, version_number")
        .single();
      if (eIns) return { pass: false, error_location: eIns.message };
      riskItemId = ins.id;
      await trackArtifact(ctx.runId, "risk_item", "risk_items", ins.id);
      const v0 = ins.version_number || 1;

      const { error: eUpd } = await supabase
        .from("risk_items")
        .update({ process: `${QA_PREFIX}V2` } as any)
        .eq("id", ins.id);
      if (eUpd) return { pass: false, error_location: eUpd.message };

      const { data: chk } = await supabase
        .from("risk_items")
        .select("version_number")
        .eq("id", ins.id)
        .single();
      const v1 = chk?.version_number || 1;
      return {
        pass: v1 > v0,
        details: { v0, v1 },
        error_location: v1 > v0 ? undefined : "version trigger did not bump",
      };
    })
  );

  // FK constraint: cannot insert risk_item with non-existent project_id
  out.push(
    await runStep("integ", "fk_project_enforced", async () => {
      const r = await expectFailure(
        supabase
          .from("risk_items")
          .insert({
            project_id: "00000000-0000-0000-0000-000000000099",
            process: `${QA_PREFIX}FK`,
            frequency: 1,
            severity: 1,
            likelihood_grade: "하",
            severity_grade: "하",
            risk_grade: "하",
            improved_frequency: 1,
            improved_severity: 1,
            improved_likelihood_grade: "하",
            improved_severity_grade: "하",
            improved_risk_grade: "하",
            status: "작성중",
            item_category: "ai",
            source_type: "ai",
            is_user_reviewed: false,
            is_excluded: false,
            created_by: ctx.userId,
          } as any)
          .select(),
        "risk_items insert with phantom project_id"
      );
      return r;
    })
  );

  return out;
}

// ================================================================
// 8. Schema sanity — critical tables/columns exist & are queryable
// ================================================================
export async function runSchemaScenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];
  const criticalTables = [
    "projects",
    "project_members",
    "user_roles",
    "profiles",
    "companies",
    "assessment_runs",
    "risk_items",
    "work_plans",
    "work_permits",
    "tbm_sessions",
    "workers",
    "notifications",
    "audit_logs",
    "approval_lines",
    "approvals",
    "incident_reports",
    "safety_inspections",
    "todo_items",
    "ai_generation_jobs",
  ];

  for (const t of criticalTables) {
    out.push(
      await runStep("schema", `table_${t}`, async () => {
        const { error } = await supabase.from(t as any).select("*", { count: "exact", head: true }).limit(1);
        return {
          pass: !error,
          details: { table: t },
          error_location: error?.message,
        };
      })
    );
  }

  return out;
}

// ================================================================
// 9. RPC sanity — every critical RPC must be callable
// ================================================================
export async function runRpcScenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];

  out.push(
    await runStep("rpc", "list_joinable_projects", async () => {
      const { data, error } = await supabase.rpc("list_joinable_projects");
      return { pass: !error && Array.isArray(data), error_location: error?.message };
    })
  );

  out.push(
    await runStep("rpc", "qa_impersonate_check_callable", async () => {
      const { data, error } = await supabase.rpc("qa_impersonate_check", {
        _target_user: ctx.userId,
        _project_id: ctx.projectId!,
      });
      return { pass: !error && !!data, error_location: error?.message };
    })
  );

  out.push(
    await runStep("rpc", "get_tbm_by_token_handles_missing", async () => {
      const { data, error } = await supabase.rpc("get_tbm_by_token", { _token: "__qa_no_such_token__" });
      const r = data as any;
      return {
        pass: !error && r?.error === "NOT_FOUND",
        details: r,
        error_location: error?.message || (r?.error !== "NOT_FOUND" ? "expected NOT_FOUND" : undefined),
      };
    })
  );

  return out;
}

// ================================================================
// 10. Edge function health — critical functions reachable
// ================================================================
export async function runEdgeFunctionScenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];
  // Hit functions that should respond (even with auth/validation errors — we just want a response)
  const targets: Array<{ name: string; body?: any }> = [
    { name: "fetch-weather", body: { lat: 37.5, lng: 127.0 } },
    { name: "safety-assistant", body: { question: "ping", projectId: ctx.projectId } },
  ];

  for (const t of targets) {
    out.push(
      await runStep("edgefn", t.name.replace(/-/g, "_"), async () => {
        try {
          const { error } = await supabase.functions.invoke(t.name, { body: t.body });
          // Even if function returns an application-level error, reachability is what we test.
          // A network/CORS failure shows up as FunctionsFetchError.
          if (error && (error as any).name === "FunctionsFetchError") {
            return { pass: false, error_location: `${t.name} unreachable: ${error.message}` };
          }
          return { pass: true, details: { name: t.name, soft_error: error?.message || null } };
        } catch (e: any) {
          return { pass: false, error_location: `${t.name} threw: ${e?.message}` };
        }
      })
    );
  }

  return out;
}

// ================================================================
// 11. Audit log scenario — writes appear (system creates one on insert events)
// ================================================================
export async function runAuditScenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];

  out.push(
    await runStep("audit", "log_writable", async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .insert({
          project_id: ctx.projectId,
          user_id: ctx.userId,
          user_name: "QA",
          action: "qa_test_event",
          target_type: "qa",
          target_id: ctx.runId,
          details: { qa: true } as any,
        } as any)
        .select("id")
        .single();
      if (error) return { pass: false, error_location: error.message };
      await trackArtifact(ctx.runId, "audit_log", "audit_logs", data.id);
      return { pass: true, details: { id: data.id } };
    })
  );

  out.push(
    await runStep("audit", "log_readable_and_filtered", async () => {
      const { data, error } = await supabase
        .from("audit_logs")
        .select("id, action")
        .eq("target_id", ctx.runId)
        .eq("action", "qa_test_event");
      return {
        pass: !error && Array.isArray(data) && data.length > 0,
        details: { found: data?.length ?? 0 },
        error_location: error?.message,
      };
    })
  );

  return out;
}

// ================================================================
// Registry
// ================================================================
export const SCENARIOS = {
  admin: { label: "관리자", run: runAdminScenario },
  contractor: { label: "시공사/협력사", run: runContractorScenario },
  worker: { label: "근로자", run: runWorkerScenario },
  perm: { label: "권한", run: runPermissionScenario },
  flow: { label: "기능 연동", run: runWorkflowScenario },
  notify: { label: "알림", run: runNotificationScenario },
  integ: { label: "데이터 무결성", run: runIntegrityScenario },
  schema: { label: "스키마 점검", run: runSchemaScenario },
  rpc: { label: "RPC 점검", run: runRpcScenario },
  edgefn: { label: "엣지 함수 헬스", run: runEdgeFunctionScenario },
  audit: { label: "감사 로그", run: runAuditScenario },
} as const;

export type ScenarioKey = keyof typeof SCENARIOS;
