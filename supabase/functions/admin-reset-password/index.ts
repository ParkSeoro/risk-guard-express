// Master-only admin password override via Auth Admin API (service role).
// Client cannot call updateUserById; this Edge Function verifies MASTER then applies the change.
//
// IMPORTANT: Expected failures return HTTP 200 with `{ ok: false, error, detail, message }`
// so supabase-js exposes the body (non-2xx collapses to a generic FunctionsHttpError).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MIN_PASSWORD_LEN = 8;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(error: string, detail: string, message?: string) {
  return json({
    ok: false,
    error,
    detail,
    message: message || detail,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return fail("method_not_allowed", "POST only");
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      return fail("unauthorized", "missing bearer token", "로그인 세션이 없습니다. 다시 로그인해 주세요.");
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1) Verify caller JWT via getClaims (signature check).
    // Do NOT use auth.getUser(jwt) — it requires an active session row and fails with
    // "Session from session_id claim in JWT does not exist" after password changes.
    const userSb = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: claimsData, error: claimErr } = await userSb.auth.getClaims(token);
    const callerId = claimsData?.claims?.sub as string | undefined;
    if (claimErr || !callerId) {
      console.error("[admin-reset-password] getClaims failed:", claimErr?.message);
      return fail(
        "unauthorized",
        claimErr?.message ?? "invalid token",
        "로그인 세션이 만료되었거나 무효입니다. 로그아웃 후 다시 로그인해 주세요.",
      );
    }

    // Optional: resolve email for audit (best-effort; never block)
    let callerEmail = "";
    try {
      const { data: adminUser } = await admin.auth.admin.getUserById(callerId);
      callerEmail = adminUser?.user?.email || "";
    } catch {
      /* ignore */
    }

    // 2) Defense in depth: require MASTER via RPC (user_roles)
    const { data: isMaster, error: roleErr } = await admin.rpc("is_master", {
      _user_id: callerId,
    });
    if (roleErr || !isMaster) {
      console.error("[admin-reset-password] is_master failed:", roleErr?.message, "result=", isMaster);
      return fail(
        "forbidden",
        roleErr?.message ?? "master role required",
        "마스터 권한이 있는 계정만 비밀번호를 강제 변경할 수 있습니다.",
      );
    }

    let body: { user_id?: string; new_password?: string };
    try {
      body = await req.json();
    } catch {
      return fail("invalid_json", "request body must be JSON", "요청 형식이 올바르지 않습니다.");
    }

    const targetUserId = (body.user_id || "").trim();
    const newPassword = body.new_password || "";

    if (!targetUserId || !/^[0-9a-f-]{36}$/i.test(targetUserId)) {
      return fail("invalid_user_id", "user_id must be a UUID", "대상 사용자 ID가 올바르지 않습니다.");
    }
    if (typeof newPassword !== "string" || newPassword.length < MIN_PASSWORD_LEN) {
      return fail(
        "invalid_password",
        `password must be at least ${MIN_PASSWORD_LEN} characters`,
        `비밀번호는 ${MIN_PASSWORD_LEN}자 이상이어야 합니다.`,
      );
    }

    // 3) Admin API — overwrite password without knowing the old one
    const { data: updated, error: updateErr } = await admin.auth.admin.updateUserById(
      targetUserId,
      { password: newPassword },
    );
    if (updateErr || !updated?.user) {
      const detail = updateErr?.message ?? "admin updateUserById failed";
      console.error("[admin-reset-password] updateUserById failed:", detail);
      const weak =
        /weak|pwned|easy to guess|leaked|compromised|at least|character/i.test(detail);
      return fail(
        "update_failed",
        detail,
        weak
          ? `비밀번호가 보안 정책에 맞지 않습니다: ${detail}`
          : `비밀번호 변경에 실패했습니다: ${detail}`,
      );
    }

    // 4) Audit trail (best-effort; never fail the password change)
    try {
      const { data: callerProfile } = await admin
        .from("profiles")
        .select("display_name")
        .eq("user_id", callerId)
        .maybeSingle();
      const { error: auditErr } = await admin.from("audit_logs").insert({
        user_id: callerId,
        user_name: callerProfile?.display_name || callerEmail || "",
        action: "비밀번호강제초기화",
        target_type: "auth_user",
        target_id: targetUserId,
        details: { by_master: true, target_email: updated.user.email ?? null },
      });
      if (auditErr) console.warn("[admin-reset-password] audit insert:", auditErr.message);
    } catch (auditErr) {
      console.warn("[admin-reset-password] audit insert failed:", auditErr);
    }

    return json({
      ok: true,
      user_id: updated.user.id,
      email: updated.user.email ?? null,
    });
  } catch (e) {
    console.error("[admin-reset-password] internal:", e);
    return fail(
      "internal_error",
      String((e as Error)?.message ?? e),
      "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
});
