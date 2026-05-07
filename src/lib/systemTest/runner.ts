import { supabase } from "@/integrations/supabase/client";

export type StepResult = {
  scenario_key: string;
  step_key: string;
  pass_fail: "pass" | "fail" | "skip";
  duration_ms: number;
  error_location?: string | null;
  details?: any;
  score?: number;
};

export type ScenarioFn = (ctx: TestContext) => Promise<StepResult[]>;

export type TestContext = {
  runId: string;
  userId: string;
  projectId: string | null;
  artifacts: Array<{ kind: string; ref_table: string; ref_id: string }>;
  log: (s: StepResult) => Promise<void>;
  onProgress?: (current: string, done: number, total: number) => void;
  priorResults?: StepResult[];
};

export async function runStep(
  scenario: string,
  step: string,
  fn: () => Promise<{ pass: boolean; details?: any; error_location?: string }>
): Promise<StepResult> {
  const start = Date.now();
  try {
    const r = await fn();
    return {
      scenario_key: scenario,
      step_key: step,
      pass_fail: r.pass ? "pass" : "fail",
      duration_ms: Date.now() - start,
      error_location: r.error_location ?? null,
      details: r.details ?? {},
      score: r.pass ? 100 : 0,
    };
  } catch (err: any) {
    return {
      scenario_key: scenario,
      step_key: step,
      pass_fail: "fail",
      duration_ms: Date.now() - start,
      error_location: err?.stack?.split("\n")[0] ?? err?.message ?? "unknown",
      details: { error: err?.message },
      score: 0,
    };
  }
}

export async function createRun(userId: string, scope: string): Promise<string> {
  const { data, error } = await supabase
    .from("system_test_runs")
    .insert({ started_by: userId, scope, status: "running" })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function finalizeRun(runId: string, results: StepResult[]) {
  const total = results.length || 1;
  const passed = results.filter((r) => r.pass_fail === "pass").length;
  const totalScore = Math.round((passed / total) * 100);
  const summary: Record<string, { total: number; pass: number }> = {};
  for (const r of results) {
    const grp = r.scenario_key.split(".")[0];
    summary[grp] = summary[grp] || { total: 0, pass: 0 };
    summary[grp].total++;
    if (r.pass_fail === "pass") summary[grp].pass++;
  }
  await supabase
    .from("system_test_runs")
    .update({
      finished_at: new Date().toISOString(),
      total_score: totalScore,
      status: results.some((r) => r.pass_fail === "fail") ? "completed_with_failures" : "completed",
      summary: summary as any,
    })
    .eq("id", runId);
}

export async function persistResults(runId: string, results: StepResult[]) {
  if (results.length === 0) return;
  await supabase.from("system_test_results").insert(
    results.map((r) => ({ ...r, run_id: runId, details: r.details as any }))
  );
}

export async function trackArtifact(
  runId: string,
  kind: string,
  table: string,
  id: string
) {
  await supabase
    .from("system_test_artifacts")
    .insert({ run_id: runId, kind, ref_table: table, ref_id: id });
}

export async function cleanupRun(runId: string) {
  const { data: arts } = await supabase
    .from("system_test_artifacts")
    .select("ref_table, ref_id")
    .eq("run_id", runId);
  if (!arts) return;
  for (const a of arts) {
    try {
      // Soft delete preferred; fallback hard delete
      const { error: softErr } = await supabase
        .from(a.ref_table as any)
        .update({ is_deleted: true } as any)
        .eq("id", a.ref_id);
      if (softErr) {
        await supabase.from(a.ref_table as any).delete().eq("id", a.ref_id);
      }
    } catch {
      /* ignore */
    }
  }
}
