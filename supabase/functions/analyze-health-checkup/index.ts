// Dedicated 1-Pass Multimodal Vision OCR for Health Checkup Reports (배치전/일반/특수/수시/임시).
// Privacy-first: strictly excludes resident registration numbers and detailed medical diagnoses;
// extracts only statutory occupational safety/health management fields.
// JWT is validated internally via userClient.auth.getUser() (verify_jwt = false in config.toml).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VALID_TYPES = new Set(["일반", "특수", "배치전", "수시", "임시"]);
const VALID_RESULTS = new Set(["정상A", "정상B", "요관찰C", "유소견D1", "유소견D2", "판정불가", "미수검"]);
const MAX_PAYLOAD_BYTES = 3_100_000;
const MODEL_TIMEOUT_MS = 25_000;

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
  });
}

function stripMarkdownFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function buildPrompt(fileName: string, extractedTextHint?: string): string {
  const hintBlock = extractedTextHint
    ? `\n[PDF 텍스트 힌트(참고용)]\n${extractedTextHint.slice(0, 1500)}\n`
    : "";

  return `당신은 대한민국 산업안전보건법(제129~131조) 기준 건강진단 결과표(일반/특수/배치전/수시/임시) 전문 판독 AI입니다.

[엄격한 개인정보 보호 규칙]
- 주민등록번호, 생년월일 뒷자리, 세부 질환명(예: 구체적 병명·검사수치 상세)은 절대 출력하지 마세요.
- 법정 안전보건 관리에 필요한 아래 항목만 추출하세요.
- 이미지에서 확인할 수 없는 값은 반드시 null로 반환하고 절대 추측·창작하지 마세요.

[입력 파일명]: ${fileName}${hintBlock}

반드시 아래 JSON 객체 하나만 출력하세요 (설명·코드블록 금지):
{
  "worker_name": "수검자 성명 (확인 불가 시 null)",
  "type": "일반" | "특수" | "배치전" | "수시" | "임시" | null,
  "result": "정상A" | "정상B" | "요관찰C" | "유소견D1" | "유소견D2" | "판정불가" | "미수검" | null,
  "conducted_date": "검진 실시일 YYYY-MM-DD (없으면 null)",
  "next_due_date": "차기 검진 예정일 YYYY-MM-DD (문서에 명시된 경우만, 없으면 null)",
  "institution": "검진기관/병원명 (없으면 null)",
  "restrictions": "업무수행 적합여부 또는 작업제한·사후관리 핵심 요약 1줄 (예: '정상업무 가능', '고소작업 주의', '야간작업 제한' — 없으면 null)",
  "hazard_factors": ["배치전/특수건강진단 유해인자 목록 (예: 소음, 분진, 용접흄, 야간작업) — 없으면 빈 배열 []"],
  "confidence": "high" | "medium" | "low",
  "summary": "판독 요약 1줄 (한국어)"
}

[판정 등급 매핑 가이드]
- A 또는 정상A -> "정상A"
- B 또는 정상B(경미한 소견) -> "정상B"
- C, C1, C2, CN, 요관찰자 -> "요관찰C"
- D1, 직업병 유소견자 -> "유소견D1"
- D2, 일반질병 유소견자, DN -> "유소견D2"
- R(제2차 검진 대상) 또는 판정 보류 -> "판정불가"`;
}

async function callGeminiVision(
  prompt: string,
  base64: string,
  mimeType: string,
): Promise<string | null> {
  const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: base64 } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
        },
      }),
    });
    if (!res.ok) {
      console.warn("[analyze-health-checkup] Gemini error:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch (err) {
    console.warn("[analyze-health-checkup] Gemini exception:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAiVision(
  prompt: string,
  base64: string,
  mimeType: string,
): Promise<string | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0.1,
        max_tokens: 1024,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      console.warn("[analyze-health-checkup] OpenAI error:", res.status, await res.text().catch(() => ""));
      return null;
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.warn("[analyze-health-checkup] OpenAI exception:", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function sanitizeDate(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResp({ ok: false, error: "Method not allowed" }, 405);

  // Verify caller JWT internally
  const authHeader = req.headers.get("Authorization") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!authHeader.startsWith("Bearer ") || !supabaseUrl || !anonKey) {
    return jsonResp({ ok: false, error: "인증이 필요합니다." }, 401);
  }
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) {
    return jsonResp({ ok: false, error: "유효한 로그인 세션이 필요합니다." }, 401);
  }

  const rawBody = await req.text();
  if (rawBody.length > MAX_PAYLOAD_BYTES) {
    return jsonResp({ ok: false, error: "이미지 용량이 너무 큽니다. 해상도를 줄여 다시 시도해 주세요." }, 413);
  }

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonResp({ ok: false, error: "잘못된 요청 형식입니다." }, 400);
  }

  const base64 = String(body?.base64 || "").trim();
  const mimeType = String(body?.mimeType || "image/jpeg").trim();
  const fileName = String(body?.fileName || "checkup.jpg").trim();
  const extractedTextHint = typeof body?.extractedTextHint === "string" ? body.extractedTextHint : undefined;

  if (!base64) {
    return jsonResp({ ok: false, error: "판독할 이미지 데이터가 없습니다." }, 400);
  }

  const prompt = buildPrompt(fileName, extractedTextHint);
  let rawText = await callGeminiVision(prompt, base64, mimeType);
  let provider = "gemini";
  if (!rawText) {
    rawText = await callOpenAiVision(prompt, base64, mimeType);
    provider = "openai";
  }
  if (!rawText) {
    return jsonResp({ ok: false, error: "AI 판독 서버 응답이 지연되었습니다. 잠시 후 다시 시도하거나 직접 입력해 주세요." }, 502);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(stripMarkdownFences(rawText));
  } catch {
    return jsonResp({ ok: false, error: "판독 결과를 해석하지 못했습니다. 선명한 결과지로 다시 시도해 주세요." }, 200);
  }

  const rawType = typeof parsed?.type === "string" ? parsed.type.trim() : "";
  const rawResult = typeof parsed?.result === "string" ? parsed.result.trim() : "";
  const hazardFactors = Array.isArray(parsed?.hazard_factors)
    ? parsed.hazard_factors.map((x: unknown) => String(x || "").trim()).filter(Boolean).slice(0, 12)
    : [];

  return jsonResp({
    ok: true,
    provider,
    worker_name: typeof parsed?.worker_name === "string" && parsed.worker_name.trim() ? parsed.worker_name.trim() : null,
    type: VALID_TYPES.has(rawType) ? rawType : null,
    result: VALID_RESULTS.has(rawResult) ? rawResult : null,
    conducted_date: sanitizeDate(parsed?.conducted_date),
    next_due_date: sanitizeDate(parsed?.next_due_date),
    institution: typeof parsed?.institution === "string" && parsed.institution.trim() ? parsed.institution.trim() : null,
    restrictions: typeof parsed?.restrictions === "string" && parsed.restrictions.trim() ? parsed.restrictions.trim() : null,
    hazard_factors: hazardFactors,
    confidence: ["high", "medium", "low"].includes(parsed?.confidence) ? parsed.confidence : "medium",
    summary: typeof parsed?.summary === "string" ? parsed.summary.trim() : "",
  });
});
