// Admin/bulk worker Auth provisioner.
// Login id = phone digits @ worker.local, password = last 4 digits of phone.
// Existing Auth users: link to project only — do NOT reset password.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WORKER_EMAIL_DOMAIN = "worker.local";

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

function digitsOnly(input: unknown): string {
  return String(input || "").replace(/\D/g, "");
}

function phoneToEmail(digits: string): string {
  return `${digits}@${WORKER_EMAIL_DOMAIN}`;
}

function pinFromPhone(digits: string): string | null {
  if (digits.length < 4) return null;
  return digits.slice(-4);
}

type WorkerIn = { phone?: string; name?: string; job_type?: string | null };

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
      return fail("unauthorized", "missing bearer token", "로그인 세션이 없습니다.");
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const userSb = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: claimsData, error: claimErr } = await userSb.auth.getClaims(token);
    const callerId = claimsData?.claims?.sub as string | undefined;
    if (claimErr || !callerId) {
      return fail(
        "unauthorized",
        claimErr?.message ?? "invalid token",
        "로그인 세션이 만료되었거나 무효입니다.",
      );
    }

    let body: {
      project_id?: string;
      company_id?: string;
      company_name?: string;
      workers?: WorkerIn[];
    };
    try {
      body = await req.json();
    } catch {
      return fail("invalid_json", "request body must be JSON");
    }

    const projectId = String(body.project_id || "").trim();
    const companyId = String(body.company_id || "").trim();
    const companyName = String(body.company_name || "").trim();
    const workersIn = Array.isArray(body.workers) ? body.workers : [];

    if (!/^[0-9a-f-]{36}$/i.test(projectId) || !/^[0-9a-f-]{36}$/i.test(companyId)) {
      return fail("invalid_args", "project_id and company_id required", "프로젝트/업체 정보가 올바르지 않습니다.");
    }
    if (workersIn.length === 0) {
      return json({ ok: true, created: 0, linked: 0, failed: 0, results: [] });
    }
    if (workersIn.length > 500) {
      return fail("too_many", "max 500 workers per request", "한 번에 최대 500명까지 가능합니다.");
    }

    // Authorization: master OR project admin/member who can manage workers
    const { data: isMaster } = await admin.rpc("is_master", { _user_id: callerId });
    if (!isMaster) {
      const { data: isAdmin } = await admin.rpc("is_project_admin", {
        _user_id: callerId,
        _project_id: projectId,
      });
      const { data: isMember } = await admin.rpc("is_project_member", {
        _user_id: callerId,
        _project_id: projectId,
      });
      if (!isAdmin && !isMember) {
        return fail("forbidden", "not a project member", "이 프로젝트에 대한 권한이 없습니다.");
      }
    }

    // Ensure company is linked to project
    const { data: pc } = await admin
      .from("project_companies")
      .select("id")
      .eq("project_id", projectId)
      .eq("company_id", companyId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (!pc) {
      return fail(
        "invalid_company",
        "company not linked to project",
        "선택한 업체가 이 프로젝트에 연결되어 있지 않습니다.",
      );
    }

    const results: Array<{ phone: string; status: string; user_id?: string; error?: string }> = [];
    let created = 0;
    let linked = 0;
    let failed = 0;

    for (const w of workersIn) {
      const digits = digitsOnly(w.phone);
      const name = String(w.name || "").trim();
      const jobType = String(w.job_type || "").trim() || null;
      const pin = pinFromPhone(digits);

      if (!/^01[016789]\d{7,8}$/.test(digits) || !name || !pin) {
        failed += 1;
        results.push({ phone: String(w.phone || ""), status: "error", error: "invalid_phone_or_name" });
        continue;
      }

      const email = phoneToEmail(digits);

      try {
        let userId: string | null = null;
        let status: "created" | "linked" = "created";

        // Prefer lookup (existing account → keep password)
        const { data: existingId } = await admin.rpc("lookup_auth_user_id_by_email", {
          _email: email,
        });
        if (existingId) {
          userId = existingId as string;
          status = "linked";
        } else {
          const createdRes = await admin.auth.admin.createUser({
            email,
            password: pin,
            email_confirm: true,
            user_metadata: {
              display_name: name,
              phone: digits,
              company: companyName,
              account_kind: "worker",
              signup_project_id: projectId,
              signup_company_id: companyId,
              signup_position: "WORKER",
              signup_job_type: jobType,
              provisioned_by: callerId,
              provisioned_via: "admin_bulk",
            },
          });

          if (createdRes.error || !createdRes.data?.user) {
            // Race / already exists
            const { data: again } = await admin.rpc("lookup_auth_user_id_by_email", {
              _email: email,
            });
            if (again) {
              userId = again as string;
              status = "linked";
            } else {
              throw createdRes.error || new Error("createUser failed");
            }
          } else {
            userId = createdRes.data.user.id;
            status = "created";
          }
        }

        // Profile: activate + phone/name (admin-provisioned workers can log in immediately)
        await admin.from("profiles").upsert(
          {
            user_id: userId,
            display_name: name,
            phone: digits,
            company: companyName || undefined,
            account_status: "active",
          },
          { onConflict: "user_id" },
        );

        // Force active even if trigger inserted pending
        await admin
          .from("profiles")
          .update({
            account_status: "active",
            phone: digits,
            display_name: name,
          })
          .eq("user_id", userId);

        // Project membership as WORKER / viewer
        await admin.rpc("process_signup_company_selection", {
          _user_id: userId,
          _project_id: projectId,
          _company_id: companyId,
          _position: "WORKER",
        });

        // Re-assert active after process_signup (it may set pending)
        await admin
          .from("profiles")
          .update({ account_status: "active" })
          .eq("user_id", userId);

        if (status === "created") created += 1;
        else linked += 1;
        results.push({ phone: digits, status, user_id: userId });
      } catch (e) {
        failed += 1;
        results.push({
          phone: digits,
          status: "error",
          error: String((e as Error)?.message ?? e),
        });
      }
    }

    // Audit (best-effort)
    try {
      await admin.from("audit_logs").insert({
        user_id: callerId,
        action: "근로자계정일괄생성",
        target_type: "workers",
        target_id: projectId,
        details: { created, linked, failed, company_id: companyId },
      });
    } catch {
      /* ignore */
    }

    return json({
      ok: true,
      created,
      linked,
      failed,
      results,
      message:
        `로그인 계정 신규 ${created} · 기존연결 ${linked}` +
        (failed ? ` · 실패 ${failed}` : "") +
        " (아이디=전화번호, 비밀번호=전화 뒤 4자리)",
    });
  } catch (e) {
    console.error("[provision-worker-accounts]", e);
    return fail(
      "internal_error",
      String((e as Error)?.message ?? e),
      "서버 오류가 발생했습니다.",
    );
  }
});
