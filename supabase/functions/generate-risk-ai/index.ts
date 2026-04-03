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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseKey);

    // Check for user-configured AI settings
    let useOpenAI = false;
    let openaiKey = "";
    let openaiModel = "gpt-4o";

    const body = await req.json();
    const { mode, section_key, section_title, process_name, equipment, work_description, work_location, work_environment, target_count, project_id } = body;

    if (project_id) {
      const { data: aiSettings } = await adminClient
        .from('ai_settings')
        .select('*')
        .eq('project_id', project_id)
        .maybeSingle();

      if (aiSettings && aiSettings.is_enabled && aiSettings.api_key_encrypted) {
        useOpenAI = true;
        openaiKey = aiSettings.api_key_encrypted;
        openaiModel = aiSettings.model || 'gpt-4o';
      }
    }

    // Determine API endpoint and key
    const apiUrl = useOpenAI
      ? "https://api.openai.com/v1/chat/completions"
      : "https://ai.gateway.lovable.dev/v1/chat/completions";
    const apiKey = useOpenAI ? openaiKey : LOVABLE_API_KEY;

    if (!apiKey) {
      return new Response(JSON.stringify({ error: "AI 설정이 필요합니다. 설정 > AI 설정에서 API Key를 입력하거나 시스템 관리자에게 문의하세요." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!process_name) {
      return new Response(JSON.stringify({ error: "공종명이 필요합니다." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============ Work Plan Section Mode ============
    if (mode === 'work_plan_section') {
      console.log('[WorkPlan AI] Section mode:', section_key, section_title);
      
      const sectionPrompts: Record<string, string> = {
        overview: `다음 공종에 대한 작업 개요를 JSON으로 작성해라:
공종: ${process_name}
출력 형식: {"work_name":"","work_date":"","work_location":"","work_content":"상세 작업내용","supervisor":"","workers_count":""}`,
        method: `다음 공종의 작업 절차를 단계별로 JSON 배열로 작성해라:
공종: ${process_name}
각 단계에 안전조치를 반드시 포함해라.
출력 형식: [{"order":1,"description":"작업단계","safety_measure":"안전조치"}]
최소 5단계 이상 작성.`,
        risk: `다음 공종의 위험요인과 안전대책을 JSON 배열로 작성해라:
공종: ${process_name}
위험요인은 "원인 + 사고결과" 구조로 작성. 안전대책은 실행 가능한 구체적 조치.
출력 형식: [{"hazard":"위험요인","situation":"발생상황","measure":"안전대책","severity":"상/중/하"}]
최소 8개 이상 작성.`,
        signal: `다음 공종의 신호체계를 JSON으로 작성해라:
공종: ${process_name}
출력 형식: {"signal_person":"신호수 자격요건","signal_method":"무전기","radio_channel":"CH-5","hand_signals":"수신호 약속 상세","emergency_signal":"비상정지 신호"}`,
        emergency: `다음 공종의 비상시 조치계획을 JSON으로 작성해라:
공종: ${process_name}
출력 형식: {"emergency_contact":"119, 현장소장","hospital":"인근병원","evacuation_route":"대피경로","assembly_point":"집결장소","first_aid":"응급처치계획","reporting_procedure":"보고체계"}`,
        equipment: `다음 공종에 필요한 장비 목록을 JSON 배열로 작성해라:
공종: ${process_name}
출력 형식: [{"name":"장비명","model":"모델명","capacity":"정격하중/용량","manufacturer":"","inspection_date":""}]
최소 3개 이상.`,
      };

      const prompt = sectionPrompts[section_key || ''] || 
        `다음 공종의 "${section_title}" 내용을 전문적으로 작성해라:\n공종: ${process_name}\n상세하고 실무적인 내용을 작성. JSON으로 출력 불가 시 텍스트로 작성.`;

      const systemPrompt = `너는 대한민국 건설현장 20년 경력의 안전관리 전문가다.
산업안전보건법, KOSHA GUIDE 기준으로 실제 현장에서 사용 가능한 수준의 작업계획서를 작성한다.
반드시 요청된 JSON 형식으로만 출력하라. 다른 텍스트나 마크다운은 절대 포함하지 마라.`;

      console.log('[WorkPlan AI] Calling gateway for section:', section_key);

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const status = response.status;
        const text = await response.text();
        console.error("[WorkPlan AI] Gateway error:", status, text);
        if (status === 429) return new Response(JSON.stringify({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (status === 402) return new Response(JSON.stringify({ error: "AI 크레딧이 부족합니다." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ error: "AI 생성 오류", detail: text }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content || "";
      console.log('[WorkPlan AI] Raw response length:', content.length);

      // Try to parse JSON from response
      try {
        const jsonMatch = content.match(/[\[{][\s\S]*[\]}]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return new Response(JSON.stringify({ structured: parsed }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (e) {
        console.log('[WorkPlan AI] JSON parse failed, returning as text');
      }

      // Fallback: return as plain text
      return new Response(JSON.stringify({ content: content.replace(/```[\s\S]*?```/g, '').trim() }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ============ Risk Assessment Mode (existing) ============
    const locationText = work_location || "일반";
    const envText = (work_environment && work_environment.length > 0) ? work_environment.join(", ") : "일반 작업 환경";
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
2. 반드시 해당 공종의 "핵심 사고 유형"을 포함하라
3. 위험요인은 반드시 "원인 + 사고결과" 구조로 작성
4. 발생상황은 실제 작업 순서를 반영
5. 개선대책은 반드시 "현장 실행 가능한 수준"으로 작성
6. 법적근거는 실제 관련 항목만 선택
7. 위험도는 실제 사고 가능성 기준으로 배분
8. 작업위치(${locationText})와 작업환경(${envText})을 반영
9. 반드시 ${count}개 항목을 작성

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

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
    });

    if (!response.ok) {
      if (response.status === 429) return new Response(JSON.stringify({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "AI 크레딧이 부족합니다." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI 생성 오류" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content || "";

    let items: any[] = [];
    try {
      const jsonMatch = content.match(/\[[\s\S]*\]/);
      if (jsonMatch) items = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr, "Content:", content);
      return new Response(JSON.stringify({ error: "AI 응답 파싱 실패", raw: content }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

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

    const processLower = process_name.toLowerCase();
    const filtered = mapped.filter((item: any) => {
      if (!item.sub_task || !item.hazard) return false;
      return true;
    });

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

    await supabase.from("ai_risk_cache").upsert({
      cache_key: cacheKey, process_name, equipment: equipText, work_description: descText,
      work_location: locationText, work_environment: work_environment || [],
      generated_items: deduped, hit_count: 0, updated_at: new Date().toISOString(),
    }, { onConflict: "cache_key" });

    return new Response(JSON.stringify({ items: deduped, source: "ai", count: deduped.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-risk-ai error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
