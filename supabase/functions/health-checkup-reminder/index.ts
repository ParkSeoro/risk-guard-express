// Health Checkup Reminder — daily cron edge function
// Scans upcoming/overdue health checkups & special-education expirations,
// then sends notifications to the project's safety managers.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });

  const today = new Date();
  const in7 = new Date(today); in7.setDate(in7.getDate() + 7);
  const isoToday = today.toISOString().slice(0, 10);
  const iso7 = in7.toISOString().slice(0, 10);

  const summary: Record<string, number> = {
    upcoming_checkups: 0,
    overdue_checkups: 0,
    expired_education: 0,
    notifications_sent: 0,
  };

  try {
    // 1) Upcoming or overdue scheduled health checkups (not yet conducted)
    const { data: due, error: dueErr } = await supabase
      .from("health_checkups")
      .select("id, project_id, worker_name, type, scheduled_date, conducted_date")
      .lte("scheduled_date", iso7)
      .is("conducted_date", null)
      .eq("is_deleted", false);

    if (dueErr) throw dueErr;

    const byProject = new Map<string, any[]>();
    for (const row of due ?? []) {
      const overdue = row.scheduled_date < isoToday;
      if (overdue) summary.overdue_checkups++; else summary.upcoming_checkups++;
      const arr = byProject.get(row.project_id) || [];
      arr.push({ ...row, overdue });
      byProject.set(row.project_id, arr);
    }

    // 2) For each project, find safety managers & dispatch single grouped notification
    for (const [projectId, rows] of byProject.entries()) {
      const { data: members } = await supabase
        .from("project_members")
        .select("user_id, position_new, role_new")
        .eq("project_id", projectId)
        .in("position_new", ["safety_manager", "health_manager"]);

      const recipients = (members ?? []).map((m) => m.user_id).filter(Boolean);
      if (recipients.length === 0) continue;

      const overdue = rows.filter((r: any) => r.overdue).length;
      const upcoming = rows.length - overdue;
      const title = `[건강진단] 예정 ${upcoming}건 · 지연 ${overdue}건`;
      const body = rows
        .slice(0, 5)
        .map((r: any) => `• ${r.worker_name} (${r.type}) - ${r.scheduled_date}${r.overdue ? " [지연]" : ""}`)
        .join("\n") + (rows.length > 5 ? `\n…외 ${rows.length - 5}건` : "");

      for (const uid of recipients) {
        await supabase.from("notifications").insert({
          user_id: uid,
          project_id: projectId,
          type: "health_checkup_reminder",
          title,
          body,
          link: "/health/checkups",
          is_read: false,
        });
        summary.notifications_sent++;
      }
    }

    // 3) Expired special-education on workers (special_education_required_until passed)
    const { data: workers } = await supabase
      .from("workers")
      .select("id, project_id, name, special_education_required_until")
      .lt("special_education_required_until", isoToday)
      .not("special_education_required_until", "is", null);

    summary.expired_education = workers?.length ?? 0;

    return new Response(JSON.stringify({ ok: true, summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
