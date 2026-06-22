/**
 * Health Module Regression Scenarios
 * 보건 모듈 회귀 테스트 (Phase H 검증)
 */
import { supabase } from "@/integrations/supabase/client";
import { runStep, StepResult, TestContext } from "./runner";

export async function runHealthScenario(ctx: TestContext): Promise<StepResult[]> {
  const out: StepResult[] = [];
  const projectId = ctx.projectId;
  if (!projectId) {
    return [{
      scenario: "health", step: "preflight", status: "skip",
      details: { reason: "no_project_in_context" },
    } as any];
  }

  // 1. health_checkups insert → todo_items auto-created
  let checkupId: string | null = null;
  out.push(await runStep("health", "checkup_creates_todo", async () => {
    const future = new Date(); future.setDate(future.getDate() + 30);
    const { data, error } = await supabase.from("health_checkups").insert({
      project_id: projectId,
      worker_name: "__QA__테스트근로자",
      type: "일반",
      scheduled_date: future.toISOString().slice(0, 10),
    }).select().single();
    if (error) return { pass: false, error_location: "health_checkups insert", details: { error: error.message } };
    checkupId = data.id;
    const { data: todos } = await supabase
      .from("todo_items")
      .select("id, title, status")
      .eq("source_table", "health_checkups")
      .eq("source_id", data.id);
    const created = (todos?.length ?? 0) > 0;
    return {
      pass: created,
      error_location: created ? undefined : "trigger trg_health_checkup_todo failed to create todo",
      details: { todo_count: todos?.length, sample: todos?.[0] },
    };
  }));

  // 2. setting conducted_date → todo auto-completed
  out.push(await runStep("health", "checkup_completion_done", async () => {
    if (!checkupId) return { pass: false, error_location: "no checkup", details: {} };
    await supabase.from("health_checkups").update({
      conducted_date: new Date().toISOString().slice(0, 10),
      result: "정상A",
    }).eq("id", checkupId);
    const { data: todos } = await supabase
      .from("todo_items").select("status")
      .eq("source_table", "health_checkups").eq("source_id", checkupId);
    const done = todos?.every((t: any) => t.status === "done");
    return {
      pass: !!done,
      error_location: done ? undefined : "todo not marked done after conducted_date",
      details: { todos },
    };
  }));

  // 3. cleanup checkup
  out.push(await runStep("health", "checkup_cleanup", async () => {
    if (!checkupId) return { pass: true, details: { skipped: true } };
    await supabase.from("health_checkups").update({ is_deleted: true }).eq("id", checkupId);
    await supabase.from("todo_items").delete()
      .eq("source_table", "health_checkups").eq("source_id", checkupId);
    return { pass: true, details: { cleaned: true } };
  }));

  // 4. env measurement exceedance → risk grade upgrade
  out.push(await runStep("health", "env_exceedance_upgrades_risk", async () => {
    // create env factor + linked risk item + exceeding measurement
    const { data: factor, error: fErr } = await supabase.from("work_env_factors").insert({
      project_id: projectId, category: "소음", name: "__QA__테스트소음", exposure_limit: 90, unit: "dB",
    }).select().single();
    if (fErr) return { pass: false, error_location: "env_factor", details: { error: fErr.message } };

    const { data: risk, error: rErr } = await supabase.from("risk_items").insert({
      project_id: projectId, process: "__QA__환경연계", severity: 1, probability: 2,
      linked_env_factor_ids: [factor.id],
    } as any).select().single();
    if (rErr) {
      await supabase.from("work_env_factors").delete().eq("id", factor.id);
      return { pass: false, error_location: "risk_item insert", details: { error: rErr.message } };
    }

    const { error: mErr } = await supabase.from("work_env_measurements").insert({
      project_id: projectId,
      factor_id: factor.id,
      factor_name: "__QA__테스트소음",
      round: "1H",
      measure_date: new Date().toISOString().slice(0, 10),
      measured_value: 95,
      exposure_limit: 90,
      unit: "dB",
      is_exceeded: true,
    });
    if (mErr) {
      await supabase.from("risk_items").delete().eq("id", risk.id);
      await supabase.from("work_env_factors").delete().eq("id", factor.id);
      return { pass: false, error_location: "measurement insert", details: { error: mErr.message } };
    }

    const { data: updated } = await supabase.from("risk_items").select("severity, auto_adjust_reason").eq("id", risk.id).single();
    const u = updated as any;
    const upgraded = (u?.severity ?? 0) >= 2;

    // cleanup
    await supabase.from("work_env_measurements").update({ is_deleted: true }).eq("factor_id", factor.id);
    await supabase.from("risk_items").delete().eq("id", risk.id);
    await supabase.from("work_env_factors").delete().eq("id", factor.id);

    return {
      pass: upgraded,
      error_location: upgraded ? undefined : "trigger trg_env_measurement_exceedance failed to upgrade risk",
      details: { severity_after: u?.severity, reason: u?.auto_adjust_reason },
    };
  }));

  // 5. hazard survey public RPCs exist & basic submit flow
  out.push(await runStep("health", "hazard_survey_public_rpcs", async () => {
    const { error: gErr } = await supabase.rpc("get_hazard_survey_public", { _qr_token: "no-such-token-xx" });
    const { error: sErr } = await supabase.rpc("submit_hazard_survey_response", {
      _qr_token: "no-such-token-xx", _worker_name: "QA",
      _worker_phone: "", _company_name: "", _scores: {} as any,
    });
    const ok = !gErr && !sErr; // RPCs must exist & return jsonb (even on not-found)
    return {
      pass: ok,
      error_location: ok ? undefined : "hazard survey RPCs missing or errored",
      details: { get_err: gErr?.message, submit_err: sErr?.message },
    };
  }));

  return out;
}
