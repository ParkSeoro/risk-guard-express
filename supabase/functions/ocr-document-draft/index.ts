import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callGeminiChat } from "../_shared/gemini.ts";
import { resolveGeminiApiKey } from "../_shared/geminiNative.ts";
import { hasChatAiKey } from "../_shared/openaiChat.ts";
import {
  geminiJsonFromText,
  mergeOcrWarnings,
  OCR_STATUS_LABEL,
  runKoreanOcr,
} from "../_shared/koreanOcr.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type DocumentType = "education_certificate" | "construction_contract";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseJsonObject(raw: string): Record<string, unknown> {
  const cleaned = String(raw || "").replace(/```json/gi, "").replace(/```/g, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  const target = match ? match[0] : cleaned;
  const parsed = JSON.parse(target);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function buildPrompt(documentType: DocumentType, ocrText: string): { system: string; prompt: string } {
  if (documentType === "education_certificate") {
    return {
      system: "당신은 대한민국 건설업 산업안전보건교육 이수증 판독 도우미입니다. 원문에 없는 값을 지어내지 말고 JSON만 반환하세요.",
      prompt: `다음은 건설근로자 안전보건교육 이수증/수료증 OCR 원문입니다.
아래 JSON 키에 맞춰 추출하세요. 확인되지 않는 항목은 null로 두세요.
- worker_name: 성명 (문자열 또는 null)
- education_type: '정기' | '채용시' | '작업변경시' | '특별' | '관리감독자' | '기초안전보건' 중 가장 가까운 것 1개 (또는 null)
- course_name: 교육과정명 (문자열 또는 null)
- hours: 이수 시간 숫자 (숫자 또는 null)
- completed_at: 이수일 YYYY-MM-DD 형식 (문자열 또는 null)
- instructor: 교육기관/강사명 (문자열 또는 null)
- notes: 등록번호 등 참고사항 한 줄 (문자열 또는 null)

OCR 원문:
${ocrText.slice(0, 6000)}`,
    };
  }

  return {
    system: "당신은 대한민국 건설공사 계약서·발주서·내역서 판독 도우미입니다. 원문에 없는 값을 지어내지 말고 JSON만 반환하세요.",
    prompt: `다음은 건설공사 계약서·발주서·도급내역서 OCR 원문입니다.
아래 JSON 키에 맞춰 추출하세요. 확인되지 않는 항목은 null로 두세요.
- construction_amount: 총 공사금액/계약금액(원 단위 정수, 예: 1500000000. 억원/만원 표기는 원으로 환산. 불명확하면 null)
- start_date: 착공일/계약시작일 YYYY-MM-DD 형식 (문자열 또는 null)
- end_date: 준공예정일/계약종료일 YYYY-MM-DD 형식 (문자열 또는 null)
- work_scope: 공종/공사명/작업범위 요약 (문자열 또는 null)
- contract_type: '원도급' | '하도급' | '직영' 중 하나 (또는 null)
- contractor_name: 시공사/수급인/상호 (문자열 또는 null)
- notes: 계약번호 등 참고사항 한 줄 (문자열 또는 null)

OCR 원문:
${ocrText.slice(0, 6000)}`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ ok: false, error: "인증 토큰이 필요합니다." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData?.user) {
      return jsonResponse({ ok: false, error: "로그인이 만료되었습니다." }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const documentType = (body?.documentType === "construction_contract"
      ? "construction_contract"
      : "education_certificate") as DocumentType;
    const fileBase64 = typeof body?.fileBase64 === "string" ? body.fileBase64 : undefined;
    const mimeType = typeof body?.mimeType === "string" ? body.mimeType : undefined;
    const text = typeof body?.text === "string" ? body.text : undefined;

    const geminiKey = await resolveGeminiApiKey();
    const ocr = await runKoreanOcr({
      fileBase64,
      mimeType,
      text,
      geminiKey,
    });

    if (!ocr.ok || !ocr.text.trim()) {
      return jsonResponse({
        ok: false,
        draft: {},
        ocr_status: ocr.status,
        confidence: ocr.confidence,
        warning: mergeOcrWarnings(ocr.warning, "AI 보완을 건너뛰었습니다. 직접 입력하세요."),
      });
    }

    const { system, prompt } = buildPrompt(documentType, ocr.text);
    let rawJson = "";
    try {
      if (hasChatAiKey()) {
        const res = await callGeminiChat({
          purpose: "general",
          compact: true,
          temperature: 0.1,
          max_tokens: 1500,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt },
          ],
        });
        rawJson = res.choices?.[0]?.message?.content || "";
      } else if (geminiKey) {
        rawJson = await geminiJsonFromText({ apiKey: geminiKey, system, prompt });
      }
    } catch (aiErr) {
      console.warn("[ocr-document-draft] structurize failed:", aiErr);
      return jsonResponse({
        ok: false,
        draft: {},
        ocr_status: ocr.status,
        confidence: ocr.confidence,
        raw_text: ocr.text.slice(0, 1500),
        warning: "AI 보완을 건너뛰었습니다. 직접 입력하세요.",
      });
    }

    if (!rawJson.trim()) {
      return jsonResponse({
        ok: false,
        draft: {},
        ocr_status: ocr.status,
        confidence: ocr.confidence,
        raw_text: ocr.text.slice(0, 1500),
        warning: "AI 보완을 건너뛰었습니다. 직접 입력하세요.",
      });
    }

    try {
      const draft = parseJsonObject(rawJson);
      return jsonResponse({
        ok: true,
        draft,
        ocr_status: ocr.status,
        confidence: ocr.confidence,
        warning: ocr.confidence != null && ocr.confidence < 0.7 ? OCR_STATUS_LABEL.ocr_low : undefined,
      });
    } catch {
      return jsonResponse({
        ok: false,
        draft: {},
        ocr_status: ocr.status,
        confidence: ocr.confidence,
        warning: "AI 보완을 건너뛰었습니다. 직접 입력하세요.",
      });
    }
  } catch (err) {
    console.warn("[ocr-document-draft] unexpected:", err);
    return jsonResponse({
      ok: false,
      draft: {},
      warning: "AI 보완을 건너뛰었습니다. 직접 입력하세요.",
    });
  }
});
