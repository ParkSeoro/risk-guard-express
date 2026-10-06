// Daily scheduler: marks overdue items, creates daily-log obligations,
// and sends one education/checkup notice per site.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  let overdue = 0, dailyLogsCreated = 0, notified = 0, legalDutyTodos = 0;

  try {
    // 1) 만료 처리
    const { data: od } = await supabase.rpc("mark_required_items_overdue");
    overdue = (od as number) || 0;

    // 2) 오늘자 일일 건강일지 의무 생성 (대상자 전원)
    const { data: targets } = await supabase
      .from("workers")
      .select("id, project_id, name, health_grade, health_checkup_status")
      .eq("is_active", true)
      .eq("requires_daily_health_log", true);

    if (targets) {
      for (const w of targets) {
        // 오늘 의무 이미 있으면 skip
        const { data: existing } = await supabase
          .from("worker_required_items")
          .select("id")
          .eq("worker_id", w.id)
          .eq("item_type", "daily_log")
          .eq("due_date", todayStr)
          .eq("is_deleted", false)
          .maybeSingle();
        if (existing) continue;

        const sub = (w.health_grade || w.health_checkup_status || "").toString().startsWith("D") ? "health_d" : "age65";
        await supabase.from("worker_required_items").insert({
          worker_id: w.id,
          project_id: w.project_id,
          item_type: "daily_log",
          subtype: sub,
          due_date: todayStr,
          status: "pending",
          source: "auto",
          legal_basis: "산업안전보건법 / 고령자·유소견자 건강관리 지침",
        });
        dailyLogsCreated++;
      }
    }

    // 3) 교육·검진은 현장당 한 줄. 사람 이름을 나열하지 않는다.
    let digestRows: Array<{
      project_id: string;
      kind: string;
      headcount: number;
      message: string;
      link: string;
    }> = [];
    try {
      const { data, error } = await supabase.rpc("education_obligation_digest");
      if (error) console.warn("education_obligation_digest", error);
      else digestRows = (data || []) as typeof digestRows;
    } catch (e) {
      console.warn("education_obligation_digest", e);
    }
    for (const row of digestRows) {
      const { data: mgrs } = await supabase
        .from("project_members")
        .select("user_id")
        .eq("project_id", row.project_id)
        .in("role_new", ["project_admin", "safety_manager"]);
      if (!mgrs || mgrs.length === 0) continue;
      const title = row.kind === "checkup"
        ? "검진 기한"
        : row.kind === "certificate"
          ? "기초안전 이수증"
          : "정기교육";
      await supabase.from("notifications").insert(
        mgrs.map((m: any) => ({
          user_id: m.user_id,
          project_id: row.project_id,
          type: row.kind === "checkup" ? "health_checkup_due" : "education_gap",
          title,
          message: row.message,
          body: row.message,
          link: row.link,
          related_type: row.kind === "checkup" ? "health_checkup" : "education",
        }))
      );
      notified += mgrs.length;
    }

    // 4) 법정의무 D-30 To-Do 자동 생성 + D-7 알림
    const { data: ldCount } = await supabase.rpc("generate_legal_duty_todos");
    legalDutyTodos = (ldCount as number) || 0;

    // 5) 작업허가서: 작업일 다음날 → 종료대기 + SM 완료확인 결재 큐
    let closurePromoted = 0;
    try {
      const { data: cCount } = await supabase.rpc("promote_permits_to_closure_pending");
      closurePromoted = (cCount as number) || 0;
    } catch (e) {
      console.warn("promote_permits_to_closure_pending", e);
    }

    // 작업계획서 종료 예고는 매일 00:00 KST 크론(scan_work_plan_end_warnings)이 날짜만 본다.

    // 6) TBM: 작업일(tbm_date) 지난 세션 자동 종료
    let tbmClosed = 0;
    try {
      const { data: tCount } = await supabase.rpc("close_expired_tbm_sessions");
      tbmClosed = (tCount as number) || 0;
    } catch (e) {
      console.warn("close_expired_tbm_sessions", e);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        overdue,
        dailyLogsCreated,
        notified,
        legalDutyTodos,
        closurePromoted,
        tbmClosed,
        date: todayStr,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("worker-daily-scheduler error", e);
    return new Response(JSON.stringify({ ok: false, error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
