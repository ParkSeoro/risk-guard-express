// Master-only admin password override via Auth Admin API (service role).
// Client cannot call updateUserById; this Edge Function verifies MASTER then applies the change.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MIN_PASSWORD_LEN = 8;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "method_not_allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return new Response(
        JSON.stringify({ error: "unauthorized", detail: "missing bearer token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1) Verify caller JWT
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(
        JSON.stringify({ error: "unauthorized", detail: userErr?.message ?? "invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const callerId = userData.user.id;

    // 2) Defense in depth: require MASTER via RPC (user_roles)
    const { data: isMaster, error: roleErr } = await admin.rpc("is_master", {
      _user_id: callerId,
    });
    if (roleErr || !isMaster) {
      return new Response(
        JSON.stringify({ error: "forbidden", detail: "master role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let body: { user_id?: string; new_password?: string };
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "invalid_json" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const targetUserId = (body.user_id || "").trim();
    const newPassword = body.new_password || "";

    if (!targetUserId || !/^[0-9a-f-]{36}$/i.test(targetUserId)) {
      return new Response(
        JSON.stringify({ error: "invalid_user_id", detail: "user_id must be a UUID" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LEN) {
      return new Response(
        JSON.stringify({
          error: "invalid_password",
          detail: `password must be at least ${MIN_PASSWORD_LEN} characters`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 3) Admin API — overwrite password without knowing the old one
    const { data: updated, error: updateErr } = await admin.auth.admin.updateUserById(
      targetUserId,
      { password: newPassword },
    );
    if (updateErr || !updated?.user) {
      return new Response(
        JSON.stringify({
          error: "update_failed",
          detail: updateErr?.message ?? "admin updateUserById failed",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 4) Audit trail (best-effort; never fail the password change)
    try {
      const { data: callerProfile } = await admin
        .from("profiles")
        .select("display_name")
        .eq("user_id", callerId)
        .maybeSingle();
      await admin.from("audit_logs").insert({
        user_id: callerId,
        user_name: callerProfile?.display_name || userData.user.email || "",
        action: "비밀번호강제초기화",
        target_type: "auth_user",
        target_id: targetUserId,
        details: { by_master: true, target_email: updated.user.email ?? null },
      });
    } catch (auditErr) {
      console.warn("[admin-reset-password] audit insert failed:", auditErr);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        user_id: updated.user.id,
        email: updated.user.email ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({
        error: "internal_error",
        detail: String((e as Error)?.message ?? e),
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
