import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { process_name, equipment, work_description, work_location, work_environment, target_count } = await req.json();

    if (!process_name) {
      return new Response(JSON.stringify({ error: "공종명이 필요합니다." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const locationText = work_location || "일반";
    const envText = (work_environment && work_environment.length > 0)
      ? work_environment.join(", ")
      : "일반 작업 환경";
    const equipText = equipment || "없음";
    const descText = work_description || process_name + " 관련 작업";
    const count = target_count || 30;

    const systemPrompt = `너는 대한민국 건설/플랜트 현장에서 20년 이상 근무한 안전관리 총괄 책임자이며,
특히 터널공사, 쉴드공법(Semi Shield, TBM 포함), 굴착공사에 대한 전문지식을 보유하고 있다.
또한 산업안전보건법, 건설기술진흥법, KOSHA GUIDE, 중대재해처벌법 기준을 모두 이해하고 있으며,
실제 현장에서 승인 가능한 수준의 위험성평가만 작성해야 한다.
단순한 일반론이 아닌, "실제 사고 사례 + 공법 특성 + 장비 위험성"을 반영해야 한다.
JSON 배열만 출력하고, 다른 텍스트는 절대 포함하지 마라.`;

    const userPrompt = `[입력 정보]
공종: ${process_name}
장비: ${equipText}
작업내용: ${descText}
작업위치: ${locationText}
작업환경: ${envText}

[핵심 요구사항]
1. 입력된 장비가 생소하더라도 반드시 "공법/용도"를 추론하라.
   - Semi Shield → 터널 굴진 장비
   - TBM 계열 → 지하 굴착 공법
   → 이런 식으로 해석 후 작성
2. 반드시 해당 공종의 "핵심 사고 유형"을 포함하라:
   - 굴착 → 붕괴, 토사유출, 지반침하, 가스
   - 고소작업 → 추락
   - 용접 → 화재, 폭발
3. 위험요인은 반드시 "원인 + 사고결과" 구조로 작성
   (예: "지반 붕괴로 인한 매몰")
4. 발생상황은 실제 작업 순서를 반영:
   - 굴진 → 버력 처리 → 지보 설치 등
5. 개선대책은 반드시 "현장 실행 가능한 수준"으로 작성:
   - 단순 주의 금지
   - 구체적 조치 필수
6. 법적근거는 아래 기준 중 실제 관련 항목만 선택:
   - 산업안전보건법
   - 산업안전보건기준에 관한 규칙
   - KOSHA GUIDE
   - 터널공사 관련 기준
7. 위험도는 실제 사고 가능성 기준으로 현실적으로 배분:
   - 상: 20~30%
   - 중: 40~60%
   - 하: 10~30%
8. 작업위치(${locationText})와 작업환경(${envText})을 반영한 위험요인 작성
9. 반드시 ${count}개 항목을 작성

[AI 자체 검증 단계]
생성 후 반드시 검토:
- 공종과 무관한 항목 제거
- 장비 관련 없는 내용 제거
- 일반론 제거 (예: "안전수칙 준수" 금지)
- 중복 제거
- 의미 없는 문장 제거

[출력 형식 - JSON 배열만 출력]
[
  {
    "공정": "${process_name}",
    "세부작업": "",
    "위험요인": "",
    "발생상황": "",
    "기존대책": "",
    "개선대책": "",
    "위험도": "상/중/하 중 하나",
    "심각도": "상/중/하 중 하나",
    "개선후위험도": "상/중/하 중 하나",
    "개선후심각도": "상/중/하 중 하나",
    "보호구": [],
    "법적근거": ""
  }
]

[절대 금지]
- 다른 공종 혼합
- 의미 없는 문장
- 반복
- 형식 깨짐`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
        }),
      }
    );

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI 크레딧이 부족합니다." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(
        JSON.stringify({ error: "AI 생성 오류" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";

    // Parse JSON from the response - handle markdown code blocks
    let items: any[] = [];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        items = JSON.parse(jsonMatch[0]);
      }
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr, "Content:", content);
      return new Response(
        JSON.stringify({ error: "AI 응답 파싱 실패", raw: content }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Map Korean field names to internal format
    const mapped = items.map((item: any) => ({
      process: item["공정"] || process_name,
      sub_task: item["세부작업"] || "",
      hazard: item["위험요인"] || "",
      hazard_situation: item["발생상황"] || "",
      existing_measure: item["기존대책"] || "",
      improvement_measure: item["개선대책"] || "",
      likelihood_grade: item["위험도"] || "중",
      severity_grade: item["심각도"] || "중",
      improved_likelihood_grade: item["개선후위험도"] || "하",
      improved_severity_grade: item["개선후심각도"] || "하",
      ppe: item["보호구"] || [],
      legal_basis: item["법적근거"] ? [item["법적근거"]] : [],
    }));

    // Quality filter: remove items with empty critical fields or process mismatch
    const processLower = process_name.toLowerCase();
    const filtered = mapped.filter((item: any) => {
      if (!item.sub_task || !item.hazard) return false;
      const itemProcess = (item.process || "").toLowerCase();
      if (itemProcess && !itemProcess.includes(processLower) && !processLower.includes(itemProcess)) return false;
      return true;
    });

    // Deduplicate
    const seen = new Set<string>();
    const deduped = filtered.filter((item: any) => {
      const key = `${item.sub_task}|${item.hazard}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Save to cache
    const cacheKey = `${process_name}|${equipText}|${descText}|${locationText}|${envText}`.toLowerCase().trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    await supabase.from("ai_risk_cache").upsert(
      {
        cache_key: cacheKey,
        process_name,
        equipment: equipText,
        work_description: descText,
        work_location: locationText,
        work_environment: work_environment || [],
        generated_items: deduped,
        hit_count: 0,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "cache_key" }
    );

    return new Response(JSON.stringify({ items: deduped, source: "ai", count: deduped.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-risk-ai error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
