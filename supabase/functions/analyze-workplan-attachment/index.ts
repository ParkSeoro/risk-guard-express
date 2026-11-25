// Work-plan attachment dedicated 1-Pass Multimodal Vision OCR & Classifier.
// Completely decoupled from safety-cost OCR prompts.
// Never mutates DB — returns structured suggestion only (user must 1-click confirm).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveGeminiApiKey } from "../_shared/geminiNative.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_IMAGES = 2;
const MAX_TOTAL_BASE64_CHARS = 4_200_000; // ~3.1MB decoded cap to prevent OOM
const VISION_TIMEOUT_MS = 25_000;

interface AvailableSlot {
  key: string;
  name: string;
}

interface ImageInput {
  base64: string;
  mimeType?: string;
  pageNumber?: number;
}

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function todayKstYmd(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function normalizeYmd(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const m = s.match(/(\d{4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function buildWorkPlanOcrPrompt(opts: {
  fileName: string;
  availableSlots: AvailableSlot[];
  extractedTextHint?: string;
  pageNumber?: number;
  totalPages?: number;
}): string {
  const slotList = opts.availableSlots
    .slice(0, 40)
    .map((s) => `- "${s.key}": ${s.name}`)
    .join("\n");

  const pageMeta =
    opts.totalPages && opts.totalPages > 1
      ? `현재 보고 있는 페이지: ${opts.pageNumber || 1} / 전체 ${opts.totalPages}페이지`
      : "단일 페이지 문서";

  const textHint = opts.extractedTextHint?.trim()
    ? `\n[디지털 PDF 추출 텍스트 참고]\n${opts.extractedTextHint.trim().slice(0, 2500)}`
    : "";

  return `당신은 대한민국 건설현장 작업계획서 증빙서류 판독 전문가입니다.
첨부된 이미지(또는 PDF 페이지)를 직접 보고 문서 종류를 분류하고 핵심 정보를 추출하세요.

[절대 규칙]
1. 이미지에 보이지 않는 날짜·숫자·정격하중·상호를 절대 지어내거나 추정·보간하지 마세요. 확인되지 않으면 null로 반환하세요.
2. suggested_key는 아래 허용 목록에 있는 key 중 하나만 고르거나, 확실치 않으면 null을 반환하세요.
3. 크레인/장비 제원표·하중표(Load Chart)인데 현재 페이지에 표지/목차만 있고 정격하중표가 안 보이면 needs_page_select를 true로 설정하세요.

[허용 첨부 슬롯 목록]
${slotList || '(목록 없음 — suggested_key는 null)'}

[문서 메타]
- 파일명: ${opts.fileName}
- ${pageMeta}${textHint}

반드시 아래 JSON 객체만 반환하세요:
{
  "suggested_key": "허용 목록의 key 또는 null",
  "doc_category_label": "사업자등록증 | 보험가입증명서 | 안전검사증 | 운전면허증/자격증 | 차량등록증 | 장비제원표 | 작업반경도 | 지반검토서 | 리깅플랜 | 기타 중 가장 가까운 한글명",
  "confidence": 0.0~1.0,
  "company_or_holder": "상호 또는 성명(면허/자격증) 또는 null",
  "issue_date": "YYYY-MM-DD 또는 null",
  "expiry_date": "YYYY-MM-DD (보험종료일/검사유효기간/면허적성검사 만료일) 또는 null",
  "reg_or_cert_no": "사업자번호/등록번호/검사번호/면허번호 또는 null",
  "rated_capacity_ton": 숫자(톤 단위 정격하중이 명시된 경우만) 또는 null,
  "summary": "문서 핵심 내용 1줄 한국어 요약 (30자 내외)",
  "needs_page_select": true 또는 false,
  "notes": "흐림/기울어짐/표지뿐임 등 주의사항 또는 null"
}`;
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = String(raw || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
  try {
    const p = JSON.parse(cleaned);
    if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
  } catch {
    /* try regex slice */
  }
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (m) {
    const p = JSON.parse(m[0]);
    if (p && typeof p === "object" && !Array.isArray(p)) return p as Record<string, unknown>;
  }
  throw new Error("AI 응답 JSON 파싱 실패");
}

async function callGeminiVision(
  apiKey: string,
  prompt: string,
  images: ImageInput[],
): Promise<{ parsed: Record<string, unknown>; engine: string }> {
  const model = (Deno.env.get("GEMINI_VISION_MODEL") || "gemini-2.5-flash").trim();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];
  for (const img of images) {
    parts.push({
      inline_data: {
        mime_type: img.mimeType || "image/jpeg",
        data: img.base64,
      },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
          maxOutputTokens: 1024,
        },
      }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.error?.message || `Gemini HTTP ${res.status}`);
    }
    const text = (body?.candidates?.[0]?.content?.parts || [])
      .map((p: { text?: string }) => p.text || "")
      .join("\n");
    return { parsed: parseJsonObject(text), engine: `gemini:${model}` };
  } finally {
    clearTimeout(timer);
  }
}

async function callOpenAiVision(
  prompt: string,
  images: ImageInput[],
): Promise<{ parsed: Record<string, unknown>; engine: string }> {
  const apiKey = (Deno.env.get("OPENAI_API_KEY") || "").trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY 미설정");
  const baseUrl = (Deno.env.get("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/$/, "");
  const model = (Deno.env.get("OPENAI_MODEL") || "gpt-4o-mini").trim();

  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  for (const img of images) {
    const mime = img.mimeType || "image/jpeg";
    content.push({
      type: "image_url",
      image_url: { url: `data:${mime};base64,${img.base64}`, detail: "high" },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 1024,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "대한민국 건설현장 작업계획서 증빙 판독 전문가. 원문에 없는 값은 절대 추정하지 말고 null로 JSON만 반환하세요.",
          },
          { role: "user", content },
        ],
      }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body?.error?.message || `OpenAI HTTP ${res.status}`);
    }
    const text = body?.choices?.[0]?.message?.content || "";
    return { parsed: parseJsonObject(text), engine: `openai:${model}` };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ ok: false, error: "인증 토큰이 필요합니다." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: authData, error: authErr } = await userClient.auth.getUser();
  if (authErr || !authData?.user) {
    return json({ ok: false, error: "로그인이 만료되었습니다." }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ ok: false, error: "잘못된 요청 형식입니다." }, 400);
  }

  const rawImages: ImageInput[] = Array.isArray(body.images)
    ? (body.images as ImageInput[]).slice(0, MAX_IMAGES)
    : typeof body.imageBase64 === "string"
      ? [{ base64: body.imageBase64, mimeType: String(body.mimeType || "image/jpeg") }]
      : [];

  const images = rawImages.filter(
    (img) => typeof img?.base64 === "string" && img.base64.trim().length > 32,
  );
  if (images.length === 0) {
    return json({ ok: false, error: "판독할 이미지가 없습니다." }, 400);
  }

  const totalChars = images.reduce((acc, img) => acc + img.base64.length, 0);
  if (totalChars > MAX_TOTAL_BASE64_CHARS) {
    return json(
      { ok: false, error: "판독 이미지 용량이 너무 큽니다. 페이지를 나눠서 다시 시도해 주세요." },
      413,
    );
  }

  const fileName = String(body.fileName || "attachment").slice(0, 180);
  const availableSlots: AvailableSlot[] = Array.isArray(body.availableSlots)
    ? (body.availableSlots as AvailableSlot[])
        .filter((s) => s && typeof s.key === "string" && typeof s.name === "string")
        .slice(0, 40)
    : [];
  const extractedTextHint =
    typeof body.extractedTextHint === "string" ? body.extractedTextHint : undefined;
  const pageNumber = typeof body.pageNumber === "number" ? body.pageNumber : 1;
  const totalPages = typeof body.totalPages === "number" ? body.totalPages : 1;

  const prompt = buildWorkPlanOcrPrompt({
    fileName,
    availableSlots,
    extractedTextHint,
    pageNumber,
    totalPages,
  });

  const startedAt = Date.now();
  let result: { parsed: Record<string, unknown>; engine: string } | null = null;
  let lastError = "";

  const geminiKey = await resolveGeminiApiKey();
  if (geminiKey) {
    try {
      result = await callGeminiVision(geminiKey, prompt, images);
    } catch (e: any) {
      lastError = e?.message || String(e);
      console.warn("[analyze-workplan-attachment] Gemini failed, trying fallback:", lastError);
    }
  }

  if (!result) {
    try {
      result = await callOpenAiVision(prompt, images);
    } catch (e: any) {
      lastError = e?.message || lastError || "AI Vision 호출 실패";
      console.warn("[analyze-workplan-attachment] OpenAI fallback failed:", lastError);
    }
  }

  if (!result) {
    return json({
      ok: false,
      error: "AI 서류 판독에 일시적으로 실패했습니다. 수동으로 항목을 선택해 업로드해 주세요.",
      elapsed_ms: Date.now() - startedAt,
    });
  }

  const p = result.parsed;
  const allowedKeys = new Set(availableSlots.map((s) => s.key));
  const rawSuggested = typeof p.suggested_key === "string" ? p.suggested_key.trim() : "";
  const suggestedKey = rawSuggested && allowedKeys.has(rawSuggested) ? rawSuggested : null;

  const issueDate = normalizeYmd(p.issue_date);
  const expiryDate = normalizeYmd(p.expiry_date);
  const today = todayKstYmd();
  const isExpired = expiryDate ? expiryDate < today : null;
  const confRaw = Number(p.confidence);
  const confidence = Number.isFinite(confRaw)
    ? Math.round(Math.min(1, Math.max(0, confRaw)) * 100) / 100
    : null;
  const capRaw = p.rated_capacity_ton != null ? Number(p.rated_capacity_ton) : null;
  const ratedCapacityTon = capRaw != null && Number.isFinite(capRaw) && capRaw > 0 ? capRaw : null;

  return json({
    ok: true,
    engine: result.engine,
    elapsed_ms: Date.now() - startedAt,
    page_number: pageNumber,
    total_pages: totalPages,
    suggested_key: suggestedKey,
    doc_category_label:
      typeof p.doc_category_label === "string" && p.doc_category_label.trim()
        ? p.doc_category_label.trim()
        : "기타",
    confidence,
    company_or_holder:
      typeof p.company_or_holder === "string" && p.company_or_holder.trim()
        ? p.company_or_holder.trim()
        : null,
    issue_date: issueDate,
    expiry_date: expiryDate,
    is_expired: isExpired,
    reg_or_cert_no:
      typeof p.reg_or_cert_no === "string" && p.reg_or_cert_no.trim()
        ? p.reg_or_cert_no.trim()
        : null,
    rated_capacity_ton: ratedCapacityTon,
    summary:
      typeof p.summary === "string" && p.summary.trim() ? p.summary.trim().slice(0, 120) : null,
    needs_page_select: Boolean(p.needs_page_select),
    notes: typeof p.notes === "string" && p.notes.trim() ? p.notes.trim().slice(0, 140) : null,
  });
});
