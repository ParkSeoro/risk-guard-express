import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callGeminiChat, GeminiError } from "../_shared/gemini.ts";

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
`;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function fallbackParse(text: string) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const items: any[] = [];
  for (const line of lines) {
    const amountMatch = line.match(/([0-9,]{4,})\s*원?$/);
    if (!amountMatch) continue;
    const amount = Number(amountMatch[1].replace(/,/g, ""));
    const name = line.replace(amountMatch[0], "").trim();
    if (!name || amount <= 0) continue;
    items.push({ transaction_date: "", usage_date: "", item_name: name, specification: "", maker: "", quantity: 1, unit: "식", unit_price: amount, supply_amount: amount, vat_amount: 0, amount, supplier_name: "", category_code: "", category_name: "검토 필요", classification_status: "review", ai_confidence: 0.3, ai_reason: "금액 패턴 기반 예비 추출입니다. 거래날짜, 공급자 상호, 공급가액/부가세 등 원본 증빙 확인이 필요합니다.", legal_basis: "건설업 산업안전보건관리비 계상 및 사용기준" });
  }
  return items;
}

function safeJsonParse(content: string) {
  const cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const geminiKey = Deno.env.get("GEMINI_API_KEY");

    const userClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Invalid token" }, 401);

    const { text = "", fileName, fileBase64, mimeType } = await req.json();
    const hasText = typeof text === "string" && text.trim().length > 0;
    const hasFile = typeof fileBase64 === "string" && fileBase64.length > 0 && typeof mimeType === "string";
    if ((!hasText && !hasFile) || (hasText && text.length > 80000) || (hasFile && fileBase64.length > 28000000)) {
      return jsonResponse({ error: "분석할 텍스트 또는 PDF/이미지 파일이 없거나 너무 큽니다." }, 400);
    }

    if (!geminiKey) {
      return jsonResponse({ items: fallbackParse(text), warning: "GEMINI_API_KEY가 없어 예비 추출만 수행했습니다." });
    }

    const prompt = `거래명세서/세금계산서/영수증/엑셀/PDF/이미지에서 한글·영문 OCR을 수행하고 산업안전보건관리비 사용내역 항목을 JSON으로만 반환하세요. 표의 각 행을 품목별로 분리하세요.
반드시 추출해야 하는 정보: 거래날짜, 품명, 규격, 메이커/제조사, 수량, 단가, 공급가액, 부가세, 공급자 상호.
거래날짜는 문서 상단의 거래일자/작성일자/공급일자/발행일자를 우선 사용하고, 행별 날짜가 있으면 행별 값을 사용하세요.
공급자 상호는 공급자/매출처/상호/업체명/회사명 영역에서 찾고 모든 품목에 반복 입력하세요.
amount는 공급가액 + 부가세가 확인되면 그 합계, 부가세가 없으면 공급가액 또는 총 금액을 넣으세요. 추정값이면 ai_reason에 추정 근거를 쓰세요.
${CATEGORY_GUIDE}
파일명: ${fileName || ""}
추출 텍스트가 있으면 보조자료로 사용:
${String(text).slice(0, 50000)}

반환 형식: {"items":[{"transaction_date":"YYYY-MM-DD 또는 빈값","usage_date":"YYYY-MM-DD 또는 빈값(transaction_date와 동일 가능)","item_name":"품명","specification":"규격","maker":"메이커/제조사 또는 빈값","quantity":숫자,"unit":"단위","unit_price":숫자,"supply_amount":숫자,"vat_amount":숫자,"amount":숫자,"supplier_name":"공급자 상호 또는 빈값","category_code":"1~9 또는 빈값","category_name":"분류명","classification_status":"usable|warning|review","ai_confidence":0~1,"ai_reason":"OCR 근거, 판단 사유와 필요한 증빙","legal_basis":"건설업 산업안전보건관리비 계상 및 사용기준의 관련 조항/별표"}],"summary":{"supplier_name":"공급자 상호","transaction_date":"YYYY-MM-DD 또는 빈값","usable_total":숫자,"warning_total":숫자,"review_total":숫자,"audit_notes":["감사 대응 확인사항"]}}`;
    const userContent = hasFile
      ? [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${fileBase64}` } },
        ]
      : prompt;

    const aiRes = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: "당신은 대한민국 산업안전보건법과 건설업 산업안전보건관리비 계상 및 사용기준 전문가입니다. 문서 OCR과 표 구조 인식에 능숙하며 공식 기준에 근거해 보수적으로 분류하고 JSON만 반환합니다." },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (aiRes.status === 429) return jsonResponse({ error: "AI 사용량이 많아 잠시 후 다시 시도하세요." }, 429);
    if (aiRes.status === 402) return jsonResponse({ error: "AI 크레딧이 부족합니다. Workspace Usage에서 충전 후 다시 시도하세요." }, 402);
    if (!aiRes.ok) return jsonResponse({ items: fallbackParse(text), warning: "AI 분석 실패로 예비 추출을 수행했습니다." });
    const aiJson = await aiRes.json();
    const content = aiJson.choices?.[0]?.message?.content || "{}";
    const parsed = safeJsonParse(content);
    return jsonResponse({ items: Array.isArray(parsed.items) ? parsed.items : [], summary: parsed.summary || null });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
