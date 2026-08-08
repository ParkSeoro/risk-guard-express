// Health Checkup Reminder — daily cron edge function
// Scans upcoming/overdue health checkups & special-education expirations,
// then sends notifications to the project's safety managers (role_new / positions).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MANAGER_ROLES = ["project_admin", "safety_manager", "site_manager"];
const MANAGER_POSITIONS = ["HSE_MANAGER", "OWNER_HSE", "OWNER_SM", "SITE_MANAGER"];

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

    // 2) For each project, notify managers via role router (not bogus position values)
    for (const [projectId, rows] of byProject.entries()) {
      const overdue = rows.filter((r: any) => r.overdue).length;
      const upcoming = rows.length - overdue;
      const title = `[건강진단] 예정 ${upcoming}건 · 지연 ${overdue}건`;
      const body = rows
        .slice(0, 5)
        .map((r: any) => `• ${r.worker_name} (${r.type}) - ${r.scheduled_date}${r.overdue ? " [지연]" : ""}`)
        .join("\n") + (rows.length > 5 ? `\n…외 ${rows.length - 5}건` : "");

      const { data: n, error: rpcErr } = await supabase.rpc("notify_project_roles", {
        _project_id: projectId,
        _roles: MANAGER_ROLES,
        _title: title,
        _message: body,
        _type: "health_checkup_reminder",
        _link: "/health/checkups",
        _company_id: null,
        _exclude_user_id: null,
        _related_type: "health_checkup",
        _related_id: null,
        _severity: overdue > 0 ? "high" : "medium",
        _positions: MANAGER_POSITIONS,
      });
      if (rpcErr) {
        // Fallback: direct role_new filter if RPC not yet migrated
        const { data: members } = await supabase
          .from("project_members")
          .select("user_id, role_new, position_new")
          .eq("project_id", projectId)
          .or(
            `role_new.in.(${MANAGER_ROLES.join(",")}),position_new.in.(${MANAGER_POSITIONS.join(",")})`,
          );

        const recipients = [...new Set(
          (members ?? [])
            .filter((m: any) => m.user_id && !["worker", "viewer"].includes(String(m.role_new || "")))
            .map((m: any) => m.user_id),
        )];
        for (const uid of recipients) {
          await supabase.from("notifications").insert({
            user_id: uid,
            project_id: projectId,
            type: "health_checkup_reminder",
            title,
            message: body,
            body,
            link: "/health/checkups",
            is_read: false,
            severity: overdue > 0 ? "high" : "medium",
          });
          summary.notifications_sent++;
        }
      } else {
        summary.notifications_sent += typeof n === "number" ? n : Number(n) || 0;
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
