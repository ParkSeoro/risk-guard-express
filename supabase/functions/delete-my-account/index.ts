// Self-service account deletion (Apple Guideline 5.1.1(v) compliant)
// Deletes the user's auth.users login, device push tokens, and personal contact PII
// while preserving legally mandated industrial safety signature/audit records.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ ok: false, error: "Server misconfigured" }, 500);
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return json({ ok: false, error: "로그인이 필요합니다." }, 401);
  }

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userErr || !userId) {
    return json({ ok: false, error: "세션이 만료되었습니다. 다시 로그인해 주세요." }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Remove push tokens & active project memberships
  await admin.from("device_push_tokens").delete().eq("user_id", userId);
  await admin.from("project_members").delete().eq("user_id", userId);

  // 2. Clear personal contact & mark profile deleted, while keeping display_name
  //    so legally mandated Korean OSHA (산업안전보건법) signatures/approvals remain attributable.
  await admin
    .from("profiles")
    .update({
      phone: null,
      account_status: "deleted",
      default_project_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  // 3. Delete login credentials from auth.users (no CASCADE exists on public tables)
  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    return json({ ok: false, error: delErr.message || "계정 삭제에 실패했습니다." }, 500);
  }

  return json({ ok: true });
});
