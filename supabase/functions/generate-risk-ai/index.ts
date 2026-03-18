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

    const systemPrompt = `너는 대한민국 건설현장의 20년 경력 안전관리자이며,
플랜트 및 일반 건설현장의 위험성평가를 실제로 수행해온 전문가다.
또한 산업안전보건법 및 위험성평가 작성 기준을 정확히 이해하고 있으며,
"현장에서 실제 제출 가능한 수준"으로만 작성해야 한다.
이 작업은 대한민국 건설/플랜트 현장에서 수행되는 작업이며,
실제 산업재해 사례를 기반으로 작성해야 한다.
JSON 배열만 출력하고, 다른 텍스트는 절대 포함하지 마라.`;

    const userPrompt = `[입력]
공종: ${process_name}
장비: ${equipText}
작업내용: ${descText}
작업위치: ${locationText}
작업환경: ${envText}

[작성 규칙]
1. 공종 + 장비 + 작업내용과 직접 관련된 내용만 ${count}개 작성
2. 다른 공종 절대 혼합 금지
3. 위험요인은 반드시 "원인 + 결과" 형태 (예: "비계 발판 미고정으로 인한 추락")
4. 발생상황은 실제 작업 흐름 기반 작성
5. 기존대책은 현재 일반적으로 시행되는 안전조치
6. 개선대책은 실행 가능한 구체적 조치로 작성
7. 위험도 분포:
   - 상: 20~30%
   - 중: 40~60%
   - 하: 10~30%
8. 법적근거는 산업안전보건법 기준 (조항 포함)
9. 작업위치(${locationText})와 작업환경(${envText})을 반영한 위험요인 작성

[AI 내부 검증]
- 공종 불일치 항목 제거
- 장비 불일치 항목 제거
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
]`;

    const response = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
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
