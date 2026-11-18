// Self-service account deletion (Apple Guideline 5.1.1(v) + Korean OSHA compliant)
// Permanently disables/strips login credentials in auth.users and removes push tokens/memberships
// WITHOUT calling auth.admin.deleteUser(), so profiles.display_name, approvals, TBM signatures,
// work permits, and audit logs remain 100% intact for statutory retention.
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

  // 2. Clear personal phone & mark profile inactive, preserving display_name for legal audit/signatures
  await admin
    .from("profiles")
    .update({
      phone: null,
      account_status: "inactive",
      default_project_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  // 3. Permanently revoke & anonymize auth.users credentials WITHOUT cascading/failing FKs
  const randomPassword = `${crypto.randomUUID()}-${crypto.randomUUID()}`;
  const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
    email: `deleted_${userId}@deleted.safenex.invalid`,
    password: randomPassword,
    email_confirm: true,
    ban_duration: "876000h",
    user_metadata: {
      account_deleted: true,
      deleted_at: new Date().toISOString(),
    },
  });

  if (updErr) {
    return json({ ok: false, error: updErr.message || "계정 삭제에 실패했습니다." }, 500);
  }

  return json({ ok: true });
});
