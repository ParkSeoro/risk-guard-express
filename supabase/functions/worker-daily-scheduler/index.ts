// Daily scheduler: marks overdue items, creates daily-log obligations,
// and sends D-7 reminder notifications for upcoming required items.
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
  const inSevenDays = new Date(today.getTime() + 7 * 86400000).toISOString().slice(0, 10);
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

    // 3) D-7 임박 항목 → 안전관리자에게 알림 (project별 1건씩)
    const { data: upcoming } = await supabase
      .from("worker_required_items")
      .select("project_id, due_date, subtype, worker_id, workers!inner(name)")
      .eq("status", "pending")
      .lte("due_date", inSevenDays)
      .gte("due_date", todayStr);

    if (upcoming && upcoming.length > 0) {
      const byProject = new Map<string, any[]>();
      for (const u of upcoming as any[]) {
        const arr = byProject.get(u.project_id) || [];
        arr.push(u);
        byProject.set(u.project_id, arr);
      }

      for (const [projectId, items] of byProject) {
        const { data: mgrs } = await supabase
          .from("project_members")
          .select("user_id")
          .eq("project_id", projectId)
          .in("role_new", ["project_admin", "safety_manager"]);
        if (!mgrs || mgrs.length === 0) continue;

        const titles = items.slice(0, 3).map((i: any) => `${i.workers?.name || ""}(${i.due_date})`).join(", ");
        const msg = `D-7 이내 마감 의무사항 ${items.length}건: ${titles}${items.length > 3 ? " 외" : ""}`;

        await supabase.from("notifications").insert(
          mgrs.map((m: any) => ({
            user_id: m.user_id,
            type: "health_checkup_due",
            title: "근로자 의무사항 마감 임박",
            message: msg,
            related_type: "worker_required_items",
          }))
        );
        notified += mgrs.length;
      }
    }

    // 4) 법정의무 D-30 To-Do 자동 생성 + D-7 알림
    const { data: ldCount } = await supabase.rpc("generate_legal_duty_todos");
    legalDutyTodos = (ldCount as number) || 0;

    return new Response(
      JSON.stringify({ ok: true, overdue, dailyLogsCreated, notified, legalDutyTodos, date: todayStr }),
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
