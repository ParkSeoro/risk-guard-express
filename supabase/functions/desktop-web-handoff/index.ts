import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_HOSTS = new Set(["safenex.org", "www.safenex.org"]);
const DEFAULT_TARGET = "https://safenex.org/app/admin";

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function safeTarget(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return DEFAULT_TARGET;
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname)) return DEFAULT_TARGET;
    url.hash = "";
    return url.toString();
  } catch {
    return DEFAULT_TARGET;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ ok: false, error: "unauthorized" });

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: "Bearer " + token } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    const user = userData?.user;
    if (userErr || !user) return json({ ok: false, error: "unauthorized" });
    if (!user.email) return json({ ok: false, error: "no_email" });

    let body: Record<string, unknown> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    const redirectTo = safeTarget(body.target);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: "magiclink",
      email: user.email,
      options: { redirectTo },
    });
    const actionLink = linkData?.properties?.action_link;
    if (linkErr || !actionLink) {
      return json({ ok: false, error: "link_failed", detail: linkErr?.message ?? "no link" });
    }

    let finalUrl = actionLink;
    try {
      const parsedUrl = new URL(actionLink);
      parsedUrl.searchParams.set("redirect_to", redirectTo);
      finalUrl = parsedUrl.toString();
    } catch {
      finalUrl = actionLink;
    }

    return json({ ok: true, url: finalUrl, target: redirectTo });
  } catch (e) {
    return json({ ok: false, error: "internal", detail: e instanceof Error ? e.message : String(e) });
  }
});
