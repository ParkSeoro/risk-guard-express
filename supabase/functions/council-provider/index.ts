// Claude and GPT seats of the AI Council. Master-only.
// The browser never sees the provider keys. One call returns that seat's reply.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SEATS = {
  anthropic: {
    secret: "ANTHROPIC_API_KEY",
    modelEnv: "ANTHROPIC_COUNCIL_MODEL",
    model: "claude-sonnet-5-5",
    missing: "Supabase 시크릿 ANTHROPIC_API_KEY가 없습니다. Anthropic 콘솔에서 만든 키를 그 이름으로 넣어 주세요.",
    role: "당신은 SafeNex AI Council의 시스템 아키텍트 Claude다. 의제와 앞선 발언만 보고 한국어로 설계 의견을 작성한다. 실행하지 않은 테스트나 합의율을 만들지 않는다.",
  },
  openai: {
    secret: "OPENAI_API_KEY",
    modelEnv: "OPENAI_COUNCIL_MODEL",
    model: "gpt-4o",
    missing: "Supabase 시크릿 OPENAI_API_KEY가 없습니다. OpenAI 대시보드에서 만든 키를 그 이름으로 넣어 주세요.",
    role: "당신은 SafeNex AI Council의 감사 GPT다. 의제와 앞선 발언만 보고 한국어로 의견을 작성한다. 실행하지 않은 테스트 결과나 합의율을 만들지 않는다.",
  },
} as const;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function fail(message: string, error = "council_provider_failed") {
  return json({ ok: false, error, message });
}

function clip(value: unknown, max: number) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > max ? text.slice(0, max) : text;
}

function prompt(agenda: string, prior: string) {
  return `의제:\n${agenda}\n\n앞선 발언:\n${prior || "(없음)"}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("POST만 받습니다.", "method_not_allowed");

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
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
  const { data: isMaster, error: roleErr } = await admin.rpc("is_master", { _user_id: callerId });
  if (roleErr || !isMaster) {
    return fail("마스터 계정만 관제실의 Claude와 GPT를 부를 수 있습니다.", "forbidden");
  }

  let body: { seat?: string; agenda?: string; prior?: string };
  try {
    body = await req.json();
  } catch {
    return fail("요청 형식이 올바르지 않습니다.", "invalid_json");
  }

  const seat = body.seat === "openai" || body.seat === "anthropic" ? SEATS[body.seat] : null;
  if (!seat) return fail("자리 이름이 올바르지 않습니다.", "unknown_seat");

  const apiKey = (Deno.env.get(seat.secret) ?? "").trim();
  if (!apiKey) return fail(seat.missing, "missing_provider_key");

  const agenda = clip(body.agenda, 2000);
  if (!agenda) return fail("의제가 비어 있습니다.", "empty_agenda");
  const prior = clip(body.prior, 4000);
  const model = (Deno.env.get(seat.modelEnv) ?? "").trim() || seat.model;
  const userText = prompt(agenda, prior);

  const res = body.seat === "anthropic"
    ? await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: seat.role,
        messages: [{ role: "user", content: userText }],
      }),
    })
    : await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [
          { role: "system", content: seat.role },
          { role: "user", content: userText },
        ],
      }),
    });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = clip(payload?.error?.message, 180);
    return fail(detail || `${body.seat} 호출에 실패했습니다. (${res.status})`, "provider_failed");
  }

  const claudeBlock = Array.isArray(payload?.content)
    ? payload.content.find((block: { type?: string; text?: string }) => block?.type === "text")
    : null;
  const text = body.seat === "anthropic"
    ? claudeBlock?.text
    : payload?.choices?.[0]?.message?.content;

  return json({ ok: true, text: clip(text, 8000) || "(응답 없음)" });
});
