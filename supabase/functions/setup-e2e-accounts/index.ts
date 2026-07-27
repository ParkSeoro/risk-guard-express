// E2E test accounts one-click setup — Master only.
// Creates 3 fixed test users via service role and assigns roles.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACCOUNTS: Array<{
  email: string;
  password: string;
  display_name: string;
  role: "safety_manager" | "contractor";
  position: string;
}> = [
  { email: "worker@test.com", password: "Test1234!@", display_name: "테스트 근로자", role: "contractor", position: "worker" },
  { email: "sub@test.com", password: "Test1234!@", display_name: "테스트 협력사 소장", role: "contractor", position: "site_manager" },
  { email: "admin@test.com", password: "Test1234!@", display_name: "테스트 원청 안전관리자", role: "safety_manager", position: "safety_manager" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify caller identity by validating the bearer token with the auth server
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized", detail: userErr?.message }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Re-check master role server-side (defense in depth)
    const { data: isMaster, error: roleErr } = await admin.rpc("has_role", {
      _user_id: userData.user.id,
      _role: "master",
    });
    if (roleErr || !isMaster) {
      return new Response(JSON.stringify({ error: "forbidden", detail: "master role required" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: Array<{ email: string; status: string; user_id?: string; error?: string }> = [];

    for (const acc of ACCOUNTS) {
      try {
        // Try create; if already exists, look up by listUsers filter
        let userId: string | null = null;
        const created = await admin.auth.admin.createUser({
          email: acc.email,
          password: acc.password,
          email_confirm: true,
          user_metadata: { display_name: acc.display_name },
        });
        if (created.error) {
          // Fallback: find existing
          const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
          const found = list?.users?.find((u) => u.email?.toLowerCase() === acc.email.toLowerCase());
          if (!found) throw created.error;
          userId = found.id;
          // Reset password to canonical value so tests are deterministic
          await admin.auth.admin.updateUserById(userId, { password: acc.password, email_confirm: true });
          results.push({ email: acc.email, status: "existing", user_id: userId });
        } else {
          userId = created.data.user!.id;
          results.push({ email: acc.email, status: "created", user_id: userId });
        }

        // Upsert profile
        await admin.from("profiles").upsert(
          {
            user_id: userId,
            display_name: acc.display_name,
            position: acc.position,
          },
          { onConflict: "user_id" }
        );

        // Assign role (idempotent)
        await admin
          .from("user_roles")
          .upsert({ user_id: userId, role: acc.role }, { onConflict: "user_id,role" });
      } catch (e) {
        results.push({ email: acc.email, status: "error", error: String((e as Error)?.message ?? e) });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, accounts: results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "internal_error", detail: String((e as Error)?.message ?? e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
