// Cursor seat of the AI Council. The director account only.
// The browser never sees the Cursor API key. This function sends one follow-up
// to the cloud agent the director already uses, then the client polls for the reply.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_AGENT_ID = "bc-5c9ec1a0-6625-4210-a11b-d7595a9996eb";
const TERMINAL = new Set(["FINISHED", "ERROR", "CANCELLED", "EXPIRED"]);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(message: string, error = "council_cursor_failed") {
  return json({ ok: false, error, message });
}

function clip(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > max ? text.slice(0, max) : text;
}

function councilPrompt(agenda: string, prior: string) {
  return [
    "이 메시지는 SafeNex AI Council 관제실의 Cursor 차례다.",
    "코드 수정, 커밋, 푸시, 풀 리퀘스트 생성, 머지는 하지 말고 한국어로 토론 답변만 작성한다.",
    "풀 리퀘스트와 머지는 디렉터만 한다.",
    "디렉터, Gemini와 동료처럼 이야기한다. 저장소의 코드와 이미 정해 둔 규칙을 보고, 맞는 점과 다른 점을 평범한 말로 적는다.",
    "판정 줄로 끝내지 않는다. 된다, 안된다, 합의가능 같은 채점 문구를 쓰지 않는다.",
    "",
    "의제:",
    agenda,
    "",
    "앞선 발언:",
    prior || "(없음)",
  ].join("\n");
}

function basicAuth(apiKey: string) {
  return `Basic ${btoa(`${apiKey}:`)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("POST만 받습니다.", "method_not_allowed");

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const apiKey = Deno.env.get("CURSOR_API_KEY") ?? "";
  const agentId = Deno.env.get("CURSOR_COUNCIL_AGENT_ID") || DEFAULT_AGENT_ID;

  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return fail("서버 설정이 없습니다.", "server_misconfigured");
  }

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return fail("로그인 세션이 없습니다. 다시 로그인해 주세요.", "unauthorized");

  const userSb = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: claimsData, error: claimErr } = await userSb.auth.getClaims(token);
  const callerId = claimsData?.claims?.sub as string | undefined;
  if (claimErr || !callerId) {
    return fail("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.", "unauthorized");
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: isDirector, error: roleErr } = await admin.rpc("is_council_director", { _user_id: callerId });
  if (roleErr || !isDirector) {
    return fail("디렉터 계정만 Cursor 관제실 자리를 부를 수 있습니다.", "forbidden");
  }

  if (!apiKey) {
    return fail(
      "Supabase 시크릿 CURSOR_API_KEY가 없습니다. Cursor 대시보드의 API Keys에서 만든 키를 그 이름으로 넣어 주세요.",
      "missing_cursor_key",
    );
  }

  let body: { action?: string; agenda?: string; prior?: string; runId?: string };
  try {
    body = await req.json();
  } catch {
    return fail("요청 형식이 올바르지 않습니다.", "invalid_json");
  }

  const headers = {
    Authorization: basicAuth(apiKey),
    "Content-Type": "application/json",
  };

  if (body.action === "start") {
    const agenda = clip(body.agenda, 2000);
    if (!agenda) return fail("의제가 비어 있습니다.", "empty_agenda");
    const prior = clip(body.prior, 14000);
    const res = await fetch(`https://api.cursor.com/v1/agents/${agentId}/runs`, {
      method: "POST",
      headers,
      body: JSON.stringify({ prompt: { text: councilPrompt(agenda, prior) } }),
    });
    if (res.status === 409) {
      return fail("이 Cursor 창이 이미 다른 답을 작성 중입니다. 그 답이 끝나면 다시 부르세요.", "agent_busy");
    }
    const payload = await res.json().catch(() => ({}));
    const runId = payload?.run?.id;
    if (!res.ok || typeof runId !== "string") {
      return fail("Cursor에 의제를 전달하지 못했습니다.", "cursor_start_failed");
    }
    return json({ ok: true, runId });
  }

  if (body.action === "status") {
    const runId = clip(body.runId, 80);
    if (!/^run-[A-Za-z0-9-]+$/.test(runId)) {
      return fail("실행 번호가 올바르지 않습니다.", "invalid_run");
    }
    const res = await fetch(`https://api.cursor.com/v1/agents/${agentId}/runs/${runId}`, { headers });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) return fail("Cursor 답변 상태를 읽지 못했습니다.", "cursor_status_failed");
    const status = String(payload?.status || "");
    if (!TERMINAL.has(status)) return json({ ok: true, done: false, status });
    if (status !== "FINISHED") {
      return fail(`Cursor 실행이 ${status} 로 끝났습니다.`, "cursor_run_failed");
    }
    const text = typeof payload?.result === "string" ? payload.result.trim() : "";
    return json({ ok: true, done: true, text: text || "(응답 없음)" });
  }

  return fail("알 수 없는 요청입니다.", "unknown_action");
});
