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

type DocumentType =
  | "education_certificate"
  | "construction_contract"
  | "msds_document"
  | "chemical_lookup"
  | "chemical_usage_plan";

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

  if (documentType === "msds_document") {
    return {
      system: "당신은 대한민국 산업안전보건법 MSDS(물질안전보건자료) 판독 도우미입니다. 원문에 없는 값을 지어내지 말고 JSON만 반환하세요.",
      prompt: `다음은 MSDS 문서/라벨 OCR 원문입니다.
아래 JSON 키에 맞춰 추출하세요. 확인되지 않는 항목은 null로 두세요.
- name: 대표 화학물질명 또는 주요 성분명 (문자열 또는 null)
- trade_name: 제품명/상품명 (문자열 또는 null)
- cas_no: 대표 CAS 번호 (예: "108-88-3", 여러 개면 주성분 1개 또는 쉼표 구분, 없으면 null)
- hazard_class: 주요 유해·위험성 구분 요약 (예: "인화성 액체 구분2, 피부자극성", 없으면 null)
- is_carcinogen: 발암성 1A/1B 또는 특별관리물질 해당 시 true, 아니면 false
- is_reproductive_toxin: 생식독성 1A/1B 해당 시 true, 아니면 false
- unit: 기본 취급 단위 (예: "L", "kg", 없으면 null)
- notes: 보관/취급 주의사항 및 기타 구성성분 요약 1~2줄 (문자열 또는 null)

OCR 원문:
${ocrText.slice(0, 6000)}`,
    };
  }

  if (documentType === "chemical_lookup") {
    return {
      system: "당신은 대한민국 산업안전보건법 및 KOSHA MSDS 화학물질 정보 도우미입니다. 불확실한 CAS 번호는 지어내지 말고 null을 반환하며 JSON만 반환하세요.",
      prompt: `사용자가 입력한 화학물질명 또는 CAS 번호를 바탕으로 표준 화학물질 정보를 초안으로 정리하세요.
입력값: ${ocrText.slice(0, 1000)}
아래 JSON 키에 맞춰 반환하세요:
- name: 표준 화학물질명 (한글명 우선, 괄호 영문 병기 가능)
- cas_no: 정확한 CAS 번호 (예: "108-88-3", 단일 물질이 아니거나 불확실하면 null)
- trade_name: 일반 제품/통용명 (또는 null)
- hazard_class: 주요 GHS 유해위험성 구분 요약 (문자열 또는 null)
- is_carcinogen: 발암성 1A/1B/2 또는 특별관리물질 해당 시 true, 아니면 false
- is_reproductive_toxin: 생식독성 해당 시 true, 아니면 false
- notes: 작업환경측정·특수건강진단 대상 여부 및 보관/보호구 주의사항 1~2줄 (문자열 또는 null)`,
    };
  }

  if (documentType === "chemical_usage_plan") {
    return {
      system: "당신은 대한민국 건설현장 화학물질 연·월 사용계획 등록 도우미입니다. JSON만 반환하세요.",
      prompt: `다음 사용자 입력(자연어 또는 반입내역)을 화학물질 사용계획 항목 배열로 변환하세요.
입력:
${ocrText.slice(0, 4000)}

반드시 {"items":[...]} 형태의 JSON 객체로 반환하세요. 각 item의 키:
- chemical_name: 물질/제품명 (문자열)
- plan_type: "annual" 또는 "monthly" (기본 "monthly")
- year: 연도 정수 (예: 2026)
- month: 월간이면 1~12 정수, 연간이면 null
- planned_qty: 계획 사용량 숫자 (또는 null)
- storage_max_qty: 최대 보관량 숫자 (또는 null)
- unit: 단위 ("L", "kg", "통" 등 또는 null)
- legal_basis: 관련 법적근거 한 줄 (예: "산안법 §114 MSDS · 화관법 시행규칙 §19")
- notes: 공정/비고 한 줄 (또는 null)`,
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
    const ALLOWED_TYPES = new Set<DocumentType>([
      "education_certificate",
      "construction_contract",
      "msds_document",
      "chemical_lookup",
      "chemical_usage_plan",
    ]);
    const documentType = (ALLOWED_TYPES.has(body?.documentType)
      ? body.documentType
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
