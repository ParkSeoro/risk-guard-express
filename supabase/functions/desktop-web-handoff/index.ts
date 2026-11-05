// SafeNex PC 프로그램 → 공식 웹사이트(safenex.org) 로그인 이어가기.
//
// PC 앱의 세션 토큰을 URL로 넘기지 않는다. 같은 refresh token을 두 곳에서 쓰면
// 한쪽이 갱신할 때 다른 쪽이 로그아웃되거나 세션 전체가 폐기될 수 있다.
// 대신 로그인한 본인에게만 1회용 매직링크를 새로 만들어 돌려준다.
// 브라우저가 그 링크를 열면 Supabase Auth가 웹 전용 새 세션을 만들어 safenex.org로 보낸다.
//
// - 호출자 JWT를 직접 검증한다 (verify_jwt = false, config.toml 참고).
// - 이메일은 요청 본문이 아니라 검증된 JWT의 사용자에서만 가져온다. 다른 사람 링크는 만들 수 없다.
// - 이동 주소는 safenex.org 계열 https 주소만 허용한다.
// - 실패는 HTTP 200 + { ok: false } 로 돌려준다. PC 앱은 실패 시 로그인 없는 일반 주소로 연다.
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
      global: { headers: { Authorization: `Bearer ${token}` } },
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

    return json({ ok: true, url: actionLink, target: redirectTo });
  } catch (e) {
    return json({ ok: false, error: "internal", detail: e instanceof Error ? e.message : String(e) });
  }
});
