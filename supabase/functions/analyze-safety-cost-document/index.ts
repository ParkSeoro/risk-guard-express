import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const AI_GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";

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
    items.push({ usage_date: "", item_name: name, specification: "", quantity: 1, unit: "식", unit_price: amount, amount, category_code: "", category_name: "검토 필요", classification_status: "review", ai_confidence: 0.3, ai_reason: "금액 패턴 기반 예비 추출입니다. 원본 증빙 확인이 필요합니다.", legal_basis: "건설업 산업안전보건관리비 계상 및 사용기준" });
  }
  return items;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");

    const userClient = createClient(supabaseUrl, supabaseAnonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Invalid token" }, 401);

    const { text, fileName } = await req.json();
    if (!text || typeof text !== "string" || text.length > 80000) {
      return jsonResponse({ error: "분석할 텍스트가 없거나 너무 깁니다." }, 400);
    }

    if (!lovableKey) {
      return jsonResponse({ items: fallbackParse(text), warning: "AI 키가 없어 예비 추출만 수행했습니다." });
    }

    const prompt = `거래명세서/세금계산서/엑셀에서 추출된 텍스트를 분석해 산업안전보건관리비 사용내역 항목을 JSON으로만 반환하세요.\n${CATEGORY_GUIDE}\n파일명: ${fileName || ""}\n텍스트:\n${text.slice(0, 50000)}\n\n반환 형식: {"items":[{"usage_date":"YYYY-MM-DD 또는 빈값","item_name":"품목","specification":"규격","quantity":숫자,"unit":"단위","unit_price":숫자,"amount":숫자,"category_code":"1~9 또는 빈값","category_name":"분류명","classification_status":"usable|warning|review","ai_confidence":0~1,"ai_reason":"판단 사유와 필요한 증빙","legal_basis":"건설업 산업안전보건관리비 계상 및 사용기준의 관련 조항/별표"}],"summary":{"usable_total":숫자,"warning_total":숫자,"review_total":숫자,"audit_notes":["감사 대응 확인사항"]}}`;

    const aiRes = await fetch(AI_GATEWAY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "당신은 대한민국 산업안전보건법과 건설업 산업안전보건관리비 계상 및 사용기준 전문가입니다. 공식 기준에 근거해 보수적으로 분류하고 JSON만 반환합니다." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!aiRes.ok) return jsonResponse({ items: fallbackParse(text), warning: "AI 분석 실패로 예비 추출을 수행했습니다." });
    const aiJson = await aiRes.json();
    const content = aiJson.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);
    return jsonResponse({ items: Array.isArray(parsed.items) ? parsed.items : [] });
  } catch (e) {
    return jsonResponse({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
