// Gemini, Claude, and GPT seats of the AI Council. The director account only.
// The browser never sees the provider keys. One call returns that seat's reply.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveGeminiApiKey } from "./geminiKey.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_MODELS = ["gemini-4-argon", "gemini-3.8-flash"] as const;

/** Gemini talks with the director and Cursor. It never sees the repository. */
const SEAT_RULE = [
  "저장소는 열 수 없다. 코드 사실은 Cursor가 이번 대화에 적은 것만 말한다. Cursor가 적지 않은 구조, 제품, 수치는 만들지 않는다.",
  "의견, 반대, 질문을 평범한 말로 한다. 판정, 합의가능, 계속 같은 채점 줄은 쓰지 않는다.",
  "실행하지 않은 테스트, 합의율, 점수는 만들지 않는다.",
].join(" ");

const SEATS = {
  gemini: {
    secret: "GEMINI_API_KEY",
    modelEnv: "GEMINI_COUNCIL_MODEL",
    model: GEMINI_MODELS[0],
    missing: "Supabase의 GEMINI_API_KEY가 없습니다. Vault 또는 Edge Function 시크릿에 그 이름으로 넣어 주세요.",
    role: `당신은 SafeNex 관제실의 Gemini다. 디렉터, Cursor와 동료처럼 이야기한다. ${SEAT_RULE}`,
  },
  anthropic: {
    secret: "ANTHROPIC_API_KEY",
    modelEnv: "ANTHROPIC_COUNCIL_MODEL",
    model: "claude-sonnet-5-5",
    missing: "Supabase 시크릿 ANTHROPIC_API_KEY가 없습니다. Anthropic 콘솔에서 만든 키를 그 이름으로 넣어 주세요.",
    role: `당신은 SafeNex AI Council의 시스템 아키텍트 Claude다. ${SEAT_RULE}`,
  },
  openai: {
    secret: "OPENAI_API_KEY",
    modelEnv: "OPENAI_COUNCIL_MODEL",
    model: "gpt-4o",
    missing: "Supabase 시크릿 OPENAI_API_KEY가 없습니다. OpenAI 대시보드에서 만든 키를 그 이름으로 넣어 주세요.",
    role: `당신은 SafeNex AI Council의 감사 GPT다. ${SEAT_RULE}`,
  },
} as const;

type SeatName = keyof typeof SEATS;

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

function isSeat(value: unknown): value is SeatName {
  return value === "gemini" || value === "anthropic" || value === "openai";
}

function geminiReply(payload: { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> }): string {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((part) => part && typeof part.text === "string" && !part.thought)
    .map((part) => part.text as string)
    .join("\n")
    .trim();
}

function geminiModelMissing(status: number, payload: { error?: { message?: string } }): boolean {
  const message = String(payload?.error?.message || "");
  return status === 404 || /not found|is not found|not supported|unknown model/i.test(message);
}

async function callGemini(apiKey: string, model: string, role: string, userText: string, timeoutMs: number) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: role }] },
          contents: [{ role: "user", parts: [{ text: userText }] }],
          generationConfig: {
            maxOutputTokens: 800,
            thinkingConfig: { thinkingLevel: "low" },
          },
        }),
      },
    );
    const payload = await res.json().catch(() => ({}));
    return { res, payload, timedOut: false };
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    if (!timedOut) throw error;
    return { res: null, payload: {}, timedOut: true };
  }
}

function tryNextGeminiModel(status: number, payload: { error?: { message?: string } }, timedOut: boolean): boolean {
  if (timedOut) return true;
  if (status === 401 || status === 403) return false;
  return geminiModelMissing(status, payload) || status === 400 || status === 408 || status === 429 || status >= 500;
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
  const { data: isDirector, error: roleErr } = await admin.rpc("is_council_director", { _user_id: callerId });
  if (roleErr || !isDirector) {
    return fail("디렉터 계정만 관제실의 Gemini, Claude, GPT를 부를 수 있습니다.", "forbidden");
  }

  let body: { seat?: string; agenda?: string; prior?: string };
  try {
    body = await req.json();
  } catch {
    return fail("요청 형식이 올바르지 않습니다.", "invalid_json");
  }

  if (!isSeat(body.seat)) return fail("자리 이름이 올바르지 않습니다.", "unknown_seat");
  if (body.seat !== "gemini") {
    return fail("관제실은 Gemini와 Cursor만 이야기합니다.", "seat_retired");
  }
  const seatName = body.seat;
  const seat = SEATS[seatName];

  const apiKey = seatName === "gemini"
    ? await resolveGeminiApiKey()
    : (Deno.env.get(seat.secret) ?? "").trim();
  if (!apiKey) return fail(seat.missing, "missing_provider_key");

  const agenda = clip(body.agenda, 2000);
  if (!agenda) return fail("의제가 비어 있습니다.", "empty_agenda");
  const prior = clip(body.prior, 14000);
  const modelOverride = (Deno.env.get(seat.modelEnv) ?? "").trim();
  const userText = prompt(agenda, prior);

  if (seatName === "gemini") {
    const models = modelOverride ? [modelOverride] : [...GEMINI_MODELS];
    let lastDetail = "";
    let lastStatus = 0;
    for (const model of models) {
      const timeoutMs = model === "gemini-4-argon" ? 20_000 : 40_000;
      const { res, payload, timedOut } = await callGemini(apiKey, model, seat.role, userText, timeoutMs);
      if (res?.ok) {
        return json({ ok: true, model, text: clip(geminiReply(payload), 12000) || "(응답 없음)" });
      }
      lastStatus = res?.status ?? 504;
      lastDetail = timedOut
        ? `${model} 응답이 시간 안에 오지 않았습니다.`
        : clip(payload?.error?.message, 180);
      if (modelOverride || !tryNextGeminiModel(lastStatus, payload, timedOut)) break;
    }
    return fail(lastDetail || `gemini 호출에 실패했습니다. (${lastStatus})`, "provider_failed");
  }

  const model = modelOverride || seat.model;
  const res = seatName === "anthropic"
    ? await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 600,
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
        max_tokens: 600,
        messages: [
          { role: "system", content: seat.role },
          { role: "user", content: userText },
        ],
      }),
    });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = clip(payload?.error?.message, 180);
    return fail(detail || `${seatName} 호출에 실패했습니다. (${res.status})`, "provider_failed");
  }

  const claudeBlock = Array.isArray(payload?.content)
    ? payload.content.find((block: { type?: string; text?: string }) => block?.type === "text")
    : null;
  const text = seatName === "anthropic"
    ? claudeBlock?.text
    : payload?.choices?.[0]?.message?.content;

  return json({ ok: true, text: clip(text, 12000) || "(응답 없음)" });
});
