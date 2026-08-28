import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callGeminiChat, GeminiError } from "../_shared/gemini.ts";
import {
  geminiJsonFromText,
  OCR_STATUS_LABEL,
  runKoreanOcr,
  stampStructuredItem,
} from "../_shared/koreanOcr.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CATEGORY_GUIDE = `
대한민국 고용노동부 고시 「건설업 산업안전보건관리비 계상 및 사용기준」 기준으로 분류한다.
분류 항목:
1. 안전·보건관리자 임금 등
2. 안전시설비 등
3. 보호구 등
4. 안전보건진단비 등
5. 안전보건교육비 등
6. 근로자 건강장해 예방비 등
7. 건설재해예방 전문지도기관 기술지도비
8. 본사 전담조직 근로자 임금 등
9. 위험성평가 등에 따른 소요비용
판단값은 usable(사용 가능), warning(사용 불가 경고), review(검토 필요) 중 하나만 사용한다.
산업재해 예방 목적과 직접 관련성이 부족한 일반공구, 일반자재, 사무용품, 식대·회식·복리후생, 유류비, 일반 장비임대료, 청소·폐기물 처리비, 일반 노무비는 warning으로 분류한다.
안전시설·보호구라도 수리·임대·운반·철거·혼합 세트처럼 비용 성격이 불명확하면 review로 분류하고 필요한 증빙을 ai_reason에 적는다.
각 항목에는 반드시 법적 근거와 보수적 판단 사유를 포함한다.
ai_reason은 비목 판단용이다. 판독 상태(ocr_status)와 섞지 마라.
`;

const SYSTEM_PROMPT = "당신은 대한민국 산업안전보건법과 건설업 산업안전보건관리비 계상 및 사용기준 전문가입니다. OCR 원문에 없는 글자·금액을 지어내지 않으며 공식 기준에 근거해 보수적으로 분류하고 JSON만 반환합니다.";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function mergeWarning(...parts: Array<string | undefined | null>) {
  const uniq = [...new Set(parts.map((p) => String(p || "").trim()).filter(Boolean))];
  return uniq.join(" · ");
}

function fallbackParse(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items: Record<string, unknown>[] = [];
  for (const line of lines) {
    const amountMatch = line.match(/([0-9,]{4,})\s*원?$/);
    if (!amountMatch) continue;
    const amount = Number(amountMatch[1].replace(/,/g, ""));
    const name = line.replace(amountMatch[0], "").trim();
    if (!name || amount <= 0) continue;
    items.push({
      transaction_date: "",
      usage_date: "",
      item_name: name,
      specification: "",
      maker: "",
      quantity: 1,
      unit: "식",
      unit_price: amount,
      supply_amount: amount,
      vat_amount: 0,
      amount,
      supplier_name: "",
      category_code: "",
      category_name: "검토 필요",
      classification_status: "review",
      ai_confidence: 0.3,
      ai_reason: "금액 패턴 기반 예비 추출입니다. 거래날짜, 공급자 상호, 공급가액/부가세 등 원본 증빙 확인이 필요합니다.",
      legal_basis: "건설업 산업안전보건관리비 계상 및 사용기준",
      ocr_status: "rule_fallback",
    });
  }
  return items;
}

function safeJsonParse(content: string) {
  const cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
}

function stampItems(
  items: unknown,
  ctx: { rawText: string; confidence: number | null; noVision?: boolean; ruleFallback?: boolean },
) {
  if (!Array.isArray(items)) return [];
  return items.map((it) => stampStructuredItem((it && typeof it === "object" ? it : {}) as Record<string, unknown>, ctx));
}

function stampLegacyDraft(
  parsed: Record<string, unknown>,
  ctx: { rawText: string; confidence: number | null; noVision?: boolean; ruleFallback?: boolean },
  extraWarning?: string,
) {
  const months = (Array.isArray(parsed.months) ? parsed.months : []).map((m: Record<string, unknown>) => {
    const items = stampItems(m.items, ctx);
    const lineTotal = items.reduce((s: number, it: Record<string, unknown>) => s + Number(it.amount || 0), 0);
    const declared = m.declared_total != null ? Number(m.declared_total) : lineTotal;
    const mismatch = Number.isFinite(declared) && Math.abs(lineTotal - declared) > 1;
    return {
      ...m,
      items: mismatch
        ? items.map((it: Record<string, unknown>) => (
          it.ocr_status === "user_edited" || it.ocr_status === "no_vision"
            ? it
            : { ...it, ocr_status: "ocr_low" }
        ))
        : items,
    };
  });
  const extraction_warning = mergeWarning(
    extraWarning,
    ctx.noVision ? OCR_STATUS_LABEL.no_vision : undefined,
    ctx.ruleFallback ? OCR_STATUS_LABEL.rule_fallback : undefined,
    ctx.confidence != null && ctx.confidence < 0.7 ? OCR_STATUS_LABEL.ocr_low : undefined,
    String((parsed as { extraction_warning?: string }).extraction_warning || ""),
  );
  return {
    construction: parsed.construction || {},
    months,
    summary: parsed.summary || {},
    extraction_warning: extraction_warning || undefined,
  };
}

async function structureFromOcr(opts: {
  nvidiaKey: string | undefined;
  geminiKey: string | undefined;
  prompt: string;
}): Promise<{ parsed: Record<string, unknown> | null; warning?: string }> {
  if (opts.nvidiaKey) {
    try {
      const aiJson = await callGeminiChat({
        model: "gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: opts.prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.2,
      });
      const content = aiJson.choices?.[0]?.message?.content || "{}";
      return { parsed: safeJsonParse(content) };
    } catch (e) {
      if (e instanceof GeminiError && (e.code === "RATE_LIMIT" || e.code === "QUOTA_EXHAUSTED")) throw e;
      // fall through to Gemini text
    }
  }
  if (opts.geminiKey) {
    try {
      const raw = await geminiJsonFromText({
        apiKey: opts.geminiKey,
        system: SYSTEM_PROMPT,
        prompt: opts.prompt,
      });
      return { parsed: safeJsonParse(raw), warning: opts.nvidiaKey ? undefined : "NVIDIA 구조화 키가 없어 Gemini 텍스트로 분류했습니다." };
    } catch (e) {
      if (e instanceof GeminiError && (e.code === "RATE_LIMIT" || e.code === "QUOTA_EXHAUSTED")) throw e;
      return { parsed: null, warning: e instanceof Error ? e.message : String(e) };
    }
  }
  return { parsed: null, warning: "NVIDIA_API_KEY·GEMINI_API_KEY가 없어 규칙 기반 예비 추출만 수행했습니다." };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const nvidiaKey = Deno.env.get("NVIDIA_API_KEY");

    const userClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Invalid token" }, 401);

    const body = await req.json();
    const { text = "", fileName, fileBase64, mimeType, mode = "transaction" } = body;
    const hasText = typeof text === "string" && text.trim().length > 0;
    const hasFile = typeof fileBase64 === "string" && fileBase64.length > 0 && typeof mimeType === "string";
    const isLegacy = mode === "legacy_pack";
    const textLimit = isLegacy ? 120000 : 80000;
    if ((!hasText && !hasFile) || (hasText && text.length > textLimit) || (hasFile && fileBase64.length > 28000000)) {
      return jsonResponse({ error: "분석할 텍스트 또는 PDF/이미지 파일이 없거나 너무 큽니다." }, 400);
    }

    const ocr = await runKoreanOcr({
      text: hasText ? text : "",
      fileBase64: hasFile ? fileBase64 : undefined,
      mimeType: hasFile ? mimeType : undefined,
      geminiKey,
    });

    const ocrText = ocr.text || "";
    const stampCtx = {
      rawText: ocrText,
      confidence: ocr.confidence,
      noVision: ocr.status === "no_vision",
      ruleFallback: false,
    };

    if (!ocrText.trim()) {
      const warning = mergeWarning(ocr.warning, OCR_STATUS_LABEL.no_vision);
      if (isLegacy) {
        return jsonResponse({
          draft: {
            months: [],
            summary: { notes: [warning] },
            extraction_warning: warning,
          },
          warning,
        });
      }
      return jsonResponse({ items: [], summary: null, warning });
    }

    const ocrBlock = `아래는 OCR 원문이다. 글자를 지어내지 마라. 원문에 없는 금액·상호·날짜를 만들지 마라.
불확실하면 해당 항목의 ocr_status를 ocr_low로 두고 classification_status는 review로 둔다.
OCR 원문과 다른 칸을 고쳤으면 fields_corrected=true.
ocr_status는 ocr_raw|ocr_low|ai_corrected|rule_fallback|no_vision 중 하나.
ocr_confidence는 0~1, ocr_raw_text에는 해당 행이 근거한 원문 일부를 넣는다.
OCR 원문:
${ocrText.slice(0, isLegacy ? 80000 : 50000)}`;

    const legacyPrompt = `이것은 이미 발주처/원청에 승인된 「산업안전보건관리비 사용내역서」 철입니다.
시스템 도입 전 이력을 SafeNex로 이관하기 위해 구조화 JSON만 반환하세요.
${ocrBlock}
추출 대상:
1) construction: 공사명, 공사종류, 공사금액, 산안비 계상총액
2) months[]: 월별 사용내역 (report_month=YYYY-MM, declared_total=해당월 총액, category_totals={"1":금액...}, items[], ppe_issuances[])
3) items: 거래날짜, 품명, 규격, 메이커, 수량, 단위, 단가, 공급가액, 부가세, amount, 공급자, category_code(1~9), classification_status, legal_basis, ai_reason, ocr_status, ocr_confidence, ocr_raw_text, fields_corrected
4) ppe_issuances: 보호구 지급대장 행(issued_at, worker_name, item_name, quantity) — 서명 이미지는 추출하지 말고 signature_note에 "스캔서명" 등만
5) summary: declared_cumulative(문서상 누계), declared_remaining(잔여), notes[]
목차(총괄·월별집계·업체별·증빙목록·항목별1~9·지급대장)를 활용해 월·비목을 분리하세요.
${CATEGORY_GUIDE}
파일명: ${fileName || ""}

반환 형식: {"construction":{"construction_name":"","construction_type":"","construction_amount":0,"safety_cost_total":0},"months":[{"report_month":"YYYY-MM","title":"","declared_total":0,"category_totals":{"1":0},"items":[{"transaction_date":"","item_name":"","specification":"","maker":"","quantity":1,"unit":"식","unit_price":0,"supply_amount":0,"vat_amount":0,"amount":0,"supplier_name":"","category_code":"3","category_name":"보호구 등","classification_status":"usable","ai_confidence":0.7,"ai_reason":"","legal_basis":"","ocr_status":"ocr_raw","ocr_confidence":0.8,"ocr_raw_text":"","fields_corrected":false}],"ppe_issuances":[{"issued_at":"","worker_name":"","item_name":"","quantity":1,"signature_note":"스캔서명"}]}],"summary":{"declared_cumulative":0,"declared_remaining":0,"notes":[]},"extraction_warning":""}`;

    const transactionPrompt = `거래명세서/세금계산서/영수증/엑셀에서 산업안전보건관리비 사용내역 항목을 JSON으로만 반환하세요. 표의 각 행을 품목별로 분리하세요.
${ocrBlock}
반드시 추출해야 하는 정보: 거래날짜, 품명, 규격, 메이커/제조사, 수량, 단가, 공급가액, 부가세, 공급자 상호.
거래날짜는 문서 상단의 거래일자/작성일자/공급일자/발행일자를 우선 사용하고, 행별 날짜가 있으면 행별 값을 사용하세요.
공급자 상호는 공급자/매출처/상호/업체명/회사명 영역에서 찾고 모든 품목에 반복 입력하세요.
amount는 공급가액 + 부가세가 확인되면 그 합계, 부가세가 없으면 공급가액 또는 총 금액을 넣으세요. 추정값이면 ai_reason에 추정 근거를 쓰세요.
${CATEGORY_GUIDE}
파일명: ${fileName || ""}

반환 형식: {"items":[{"transaction_date":"YYYY-MM-DD 또는 빈값","usage_date":"YYYY-MM-DD 또는 빈값(transaction_date와 동일 가능)","item_name":"품명","specification":"규격","maker":"메이커/제조사 또는 빈값","quantity":숫자,"unit":"단위","unit_price":숫자,"supply_amount":숫자,"vat_amount":숫자,"amount":숫자,"supplier_name":"공급자 상호 또는 빈값","category_code":"1~9 또는 빈값","category_name":"분류명","classification_status":"usable|warning|review","ai_confidence":0~1,"ai_reason":"비목 판단 사유와 필요한 증빙","legal_basis":"건설업 산업안전보건관리비 계상 및 사용기준의 관련 조항/별표","ocr_status":"ocr_raw","ocr_confidence":0~1,"ocr_raw_text":"해당 행 OCR 원문 일부","fields_corrected":false}],"summary":{"supplier_name":"공급자 상호","transaction_date":"YYYY-MM-DD 또는 빈값","usable_total":숫자,"warning_total":숫자,"review_total":숫자,"audit_notes":["감사 대응 확인사항"]}}`;

    let structured: { parsed: Record<string, unknown> | null; warning?: string };
    try {
      structured = await structureFromOcr({
        nvidiaKey,
        geminiKey,
        prompt: isLegacy ? legacyPrompt : transactionPrompt,
      });
    } catch (e) {
      if (e instanceof GeminiError) {
        if (e.code === "RATE_LIMIT") return jsonResponse({ error: e.message }, 429);
        if (e.code === "QUOTA_EXHAUSTED") return jsonResponse({ error: e.message }, 402);
      }
      structured = { parsed: null, warning: e instanceof Error ? e.message : String(e) };
    }

    if (isLegacy) {
      if (!structured.parsed) {
        const warning = mergeWarning(ocr.warning, structured.warning, OCR_STATUS_LABEL.rule_fallback);
        return jsonResponse({
          draft: {
            months: [],
            summary: { notes: [warning] },
            extraction_warning: warning,
          },
          warning,
        });
      }
      const draft = stampLegacyDraft(structured.parsed, stampCtx, mergeWarning(ocr.warning, structured.warning));
      return jsonResponse({
        draft,
        warning: draft.extraction_warning || mergeWarning(ocr.warning, structured.warning) || undefined,
      });
    }

    if (!structured.parsed) {
      const items = stampItems(fallbackParse(ocrText), { ...stampCtx, ruleFallback: true });
      const warning = mergeWarning(ocr.warning, structured.warning, OCR_STATUS_LABEL.rule_fallback);
      return jsonResponse({ items, summary: null, warning });
    }

    const items = stampItems(structured.parsed.items, stampCtx);
    const warning = mergeWarning(
      ocr.warning,
      structured.warning,
      items.some((it: Record<string, unknown>) => it.ocr_status === "ocr_low") ? OCR_STATUS_LABEL.ocr_low : undefined,
      items.some((it: Record<string, unknown>) => it.ocr_status === "no_vision") ? OCR_STATUS_LABEL.no_vision : undefined,
    );
    return jsonResponse({
      items,
      summary: structured.parsed.summary || null,
      warning: warning || undefined,
    });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
