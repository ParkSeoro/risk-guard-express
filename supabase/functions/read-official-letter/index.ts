import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const LETTER_PROMPT = `이것은 대한민국 회사의 발신 공문입니다.
이미지에서 보이는 한글·숫자·기호만 읽기 순서대로 옮기세요. 없는 문장과 문서번호를 만들지 마세요.
문서번호, 수신, 참조, 제목, 날짜, 본문을 빠뜨리지 마세요. 읽기 어려운 칸은 [불명]으로 표시하세요.
JSON만 반환: {"text":"전체 원문","confidence":0.0~1.0,"notes":"흐림·도장 가림 등"}`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function geminiKey(): Promise<string> {
  const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const service = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  const fromEnv = (Deno.env.get("GEMINI_API_KEY") || "").trim();
  if (!url || !service) return fromEnv;
  try {
    const resp = await fetch(`${url}/rest/v1/rpc/get_runtime_secret`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: service,
        Authorization: `Bearer ${service}`,
      },
      body: JSON.stringify({ secret_name: "GEMINI_API_KEY" }),
    });
    if (!resp.ok) return fromEnv;
    const data = await resp.json().catch(() => null);
    const fromVault = typeof data === "string" ? data.trim() : "";
    return fromVault || fromEnv;
  } catch {
    return fromEnv;
  }
}

function parseOcrJson(raw: string): { text: string; confidence: number | null } {
  const cleaned = String(raw || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    const obj = JSON.parse(cleaned);
    return {
      text: String(obj.text || obj.transcript || obj.content || ""),
      confidence: obj.confidence != null ? Number(obj.confidence) : null,
    };
  } catch {
    return { text: cleaned, confidence: null };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "로그인이 필요합니다." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return jsonResponse({ error: "로그인이 필요합니다." }, 401);

    const { data: allowed, error: accessError } = await userClient.rpc("can_manage_owner_safety", {
      _user_id: authData.user.id,
    });
    if (accessError || allowed !== true) return jsonResponse({ error: "건설안전팀만 공문을 판독할 수 있습니다." }, 403);

    const body = await req.json().catch(() => ({}));
    const fileBase64 = typeof body.fileBase64 === "string" ? body.fileBase64 : "";
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
    if (!fileBase64 || !mimeType.startsWith("image/") || fileBase64.length > 1_800_000) {
      return jsonResponse({ error: "공문 이미지가 없거나 너무 큽니다." }, 400);
    }

    const apiKey = await geminiKey();
    if (!apiKey) {
      return jsonResponse({
        text: "",
        confidence: null,
        status: "no_vision",
        warning: "이미지 판독을 건너뛰었습니다. 문서번호를 직접 적어 주세요.",
        engine: "none",
      });
    }

    const res = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{
            role: "user",
            parts: [
              { text: LETTER_PROMPT },
              { inline_data: { mime_type: mimeType, data: fileBase64 } },
            ],
          }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json", maxOutputTokens: 8192 },
        }),
      },
    );
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = payload?.error?.message || "공문을 읽지 못했습니다.";
      return jsonResponse({ text: "", confidence: null, status: "no_vision", warning: String(message).slice(0, 180), engine: "gemini-failed" });
    }
    const parts = payload?.candidates?.[0]?.content?.parts || [];
    const parsed = parseOcrJson(parts.map((part: { text?: string }) => part.text || "").join("\n"));
    return jsonResponse({
      text: parsed.text,
      confidence: parsed.confidence,
      status: parsed.text ? "ocr_raw" : "no_vision",
      warning: parsed.text ? "" : "글자를 읽지 못했습니다. 문서번호를 직접 적어 주세요.",
      engine: "gemini-2.5-flash",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "공문을 읽지 못했습니다.";
    return jsonResponse({ error: message }, 500);
  }
});
