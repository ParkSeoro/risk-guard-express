import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Equipment normalization map ──
const EQUIPMENT_ALIASES: Record<string, string> = {
  "굴삭기": "굴착기(Excavator)",
  "굴삭": "굴착기(Excavator)",
  "포크레인": "굴착기(Excavator)",
  "excavator": "굴착기(Excavator)",
  "semi shield": "Semi Shield TBM",
  "세미쉴드": "Semi Shield TBM",
  "쉴드tbm": "Shield TBM",
  "shield tbm": "Shield TBM",
  "tbm": "TBM(Tunnel Boring Machine)",
  "크레인": "이동식 크레인(Mobile Crane)",
  "crane": "이동식 크레인(Mobile Crane)",
  "타워크레인": "타워크레인(Tower Crane)",
  "tower crane": "타워크레인(Tower Crane)",
  "고소작업차": "고소작업대(Aerial Work Platform)",
  "고소작업대": "고소작업대(Aerial Work Platform)",
  "지게차": "지게차(Forklift)",
  "forklift": "지게차(Forklift)",
  "덤프트럭": "덤프트럭(Dump Truck)",
  "dump truck": "덤프트럭(Dump Truck)",
  "콘크리트펌프카": "콘크리트펌프카(Concrete Pump Car)",
  "펌프카": "콘크리트펌프카(Concrete Pump Car)",
  "항타기": "항타기(Pile Driver)",
  "천공기": "천공기(Boring Machine)",
  "로더": "로더(Loader)",
  "loader": "로더(Loader)",
  "롤러": "롤러(Roller)",
  "roller": "롤러(Roller)",
  "브레이커": "유압브레이커(Hydraulic Breaker)",
  "breaker": "유압브레이커(Hydraulic Breaker)",
};

function normalizeEquipment(input: string): string {
  if (!input) return "";
  const lower = input.toLowerCase().trim().replace(/\s+/g, " ");
  for (const [alias, normalized] of Object.entries(EQUIPMENT_ALIASES)) {
    if (lower.includes(alias)) return normalized;
  }
  return input.trim();
}

// ── RAG: fetch similar items from existing data ──
async function fetchRAGContext(
  adminClient: any,
  processName: string,
  equipment: string,
  limit = 10
): Promise<string> {
  // Search standard_risk_library by keyword match
  const keywords = processName
    .split(/[\s,/·]+/)
    .filter((w: string) => w.length >= 2);

  let ragItems: any[] = [];

  // 1. Search standard_risk_library
  for (const kw of keywords.slice(0, 3)) {
    const { data } = await adminClient
      .from("standard_risk_library")
      .select("category_large, sub_task, hazard, hazard_situation, existing_measure, improvement_measure, recommended_ppe")
      .or(`category_large.ilike.%${kw}%,category_medium.ilike.%${kw}%,sub_task.ilike.%${kw}%,keywords.cs.{${kw}}`)
      .eq("is_active", true)
      .limit(5);
    if (data) ragItems.push(...data);
  }

  // 2. Search existing risk_items for similar processes
  const { data: existingItems } = await adminClient
    .from("risk_items")
    .select("process, sub_task, hazard, hazard_situation, existing_measure, improvement_measure, ppe")
    .ilike("process", `%${keywords[0] || processName}%`)
    .limit(5);
  if (existingItems) ragItems.push(...existingItems);

  // 3. Search by equipment
  if (equipment) {
    const normEquip = normalizeEquipment(equipment);
    const equipKw = normEquip.split(/[()/\s]+/).filter((w: string) => w.length >= 2)[0];
    if (equipKw) {
      const { data: equipItems } = await adminClient
        .from("standard_risk_library")
        .select("sub_task, hazard, hazard_situation, existing_measure, improvement_measure")
        .contains("equipment", [equipKw])
        .limit(5);
      if (equipItems) ragItems.push(...equipItems);
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const unique = ragItems.filter((item: any) => {
    const key = `${item.sub_task || ""}|${item.hazard || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, limit);

  if (unique.length === 0) return "";

  const lines = unique.map(
    (item: any, i: number) =>
      `${i + 1}. 세부작업: ${item.sub_task || ""}, 위험요인: ${item.hazard || ""}, 발생상황: ${item.hazard_situation || ""}, 기존대책: ${item.existing_measure || ""}, 개선대책: ${item.improvement_measure || ""}`
  );

  return `\n[참고 사례 - 유사 공종/장비 기존 데이터]\n${lines.join("\n")}`;
}

// ── Generate a single batch of items ──
async function generateBatch(
  apiUrl: string,
  apiKey: string,
  model: string,
  processName: string,
  equipText: string,
  descText: string,
  locationText: string,
  envText: string,
  batchCount: number,
  ragContext: string,
  batchIndex: number
): Promise<any[]> {
  const systemPrompt = `너는 대한민국 건설/플랜트 현장에서 20년 이상 근무한 안전관리 총괄 책임자이며,
특히 터널공사, 쉴드공법(Semi Shield, TBM 포함), 굴착공사에 대한 전문지식을 보유하고 있다.
또한 산업안전보건법, 건설기술진흥법, KOSHA GUIDE, 중대재해처벌법 기준을 모두 이해하고 있으며,
실제 현장에서 승인 가능한 수준의 위험성평가만 작성해야 한다.
JSON 배열만 출력하고, 다른 텍스트는 절대 포함하지 마라.`;

  const userPrompt = `[입력 정보]
공종: ${processName}
장비: ${equipText}
작업내용: ${descText}
작업위치: ${locationText}
작업환경: ${envText}
배치번호: ${batchIndex + 1} (중복 방지를 위해 이전 배치와 다른 세부작업을 작성)
${ragContext}

[핵심 요구사항]
1. 입력된 장비가 생소하더라도 반드시 "공법/용도"를 추론하라
2. 반드시 해당 공종의 "핵심 사고 유형"을 포함하라
3. 위험요인은 반드시 "원인 + 사고결과" 구조로 작성
4. 발생상황은 실제 작업 순서를 반영
5. 개선대책은 반드시 "현장 실행 가능한 수준"으로 작성
6. 법적근거는 실제 관련 항목만 선택
7. 위험도는 실제 사고 가능성 기준으로 배분 (상 20-30%, 중 40-60%, 하 10-30%)
8. 작업위치(${locationText})와 작업환경(${envText})을 반영
9. 참고 사례가 있으면 반드시 참고하되, 동일한 내용은 금지
10. 반드시 ${batchCount}개 항목을 작성

[출력 형식 - JSON 배열만 출력]
[
  {
    "공정": "${processName}",
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

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.4 + batchIndex * 0.05, // slightly vary for diversity
    }),
  });

  if (!response.ok) {
    const status = response.status;
    const text = await response.text();
    console.error(`[Batch ${batchIndex}] AI error:`, status, text);
    if (status === 429) throw new Error("RATE_LIMIT");
    if (status === 402) throw new Error("CREDITS_EXHAUSTED");
    // Lovable AI Gateway returns 403 with credit_limit_reached when workspace limit is hit
    if (status === 403 && /credit_limit_reached|credit limit/i.test(text)) {
      throw new Error("CREDITS_EXHAUSTED");
    }
    throw new Error(`AI_ERROR_${status}`);
  }

  const result = await response.json();
  const content = result.choices?.[0]?.message?.content || "";

  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (parseErr) {
    console.error(`[Batch ${batchIndex}] Parse error:`, parseErr);
  }
  return [];
}

function mapAndDedupe(items: any[], processName: string, existingKeys: Set<string>): any[] {
  const mapped = items.map((item: any) => ({
    process: item["공정"] || processName,
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

  return mapped.filter((item: any) => {
    if (!item.sub_task || !item.hazard) return false;
    const key = `${item.sub_task}|${item.hazard}`;
    if (existingKeys.has(key)) return false;
    existingKeys.add(key);
    return true;
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { headers: corsHeaders });

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseKey);

    // Auth: allow service-role (internal orchestrator) OR validate user JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const token = authHeader.slice(7);
    const isInternal = token === supabaseKey;
    if (!isInternal) {
      const userSb = createClient(supabaseUrl, anonKey);
      const { data: claims, error: claimErr } = await userSb.auth.getClaims(token);
      if (claimErr || !claims?.claims?.sub) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }),
          { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    const body = await req.json();
    const {
      mode,
      section_key,
      section_title,
      process_name,
      equipment,
      work_description,
      work_location,
      work_environment,
      target_count,
      project_id,
      batch_index,
      batch_size,
    } = body;

    // Verify project membership for non-internal callers
    if (!isInternal && project_id) {
      const userSb = createClient(supabaseUrl, anonKey,
        { global: { headers: { Authorization: authHeader } } });
      const { data: isMember } = await userSb.rpc('is_project_member', {
        _user_id: (await userSb.auth.getClaims(token)).data!.claims.sub,
        _project_id: project_id,
      });
      if (!isMember) {
        return new Response(JSON.stringify({ error: 'Forbidden' }),
          { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }


    // ── Resolve AI settings ──
    let useOpenAI = false;
    let openaiKey = "";
    let openaiModel = "gpt-4o";

    if (project_id) {
      const { data: aiSettings } = await adminClient
        .from("ai_settings")
        .select("*")
        .eq("project_id", project_id)
        .maybeSingle();

      if (aiSettings && aiSettings.is_enabled && aiSettings.api_key_encrypted) {
        useOpenAI = true;
        openaiKey = aiSettings.api_key_encrypted;
        openaiModel = aiSettings.model || "gpt-4o";
      }
    }

    const apiUrl = useOpenAI
      ? "https://api.openai.com/v1/chat/completions"
      : "https://ai.gateway.lovable.dev/v1/chat/completions";
    const apiKey = useOpenAI ? openaiKey : LOVABLE_API_KEY;

    if (!apiKey) {
      return new Response(
        JSON.stringify({
          error: "AI 설정이 필요합니다. 설정 > AI 설정에서 API Key를 입력하거나 시스템 관리자에게 문의하세요.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!process_name) {
      return new Response(
        JSON.stringify({ error: "공종명이 필요합니다." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ Work Plan Section Mode ============
    if (mode === "work_plan_section") {
      console.log("[WorkPlan AI] Section mode:", section_key, section_title);

      const sectionPrompts: Record<string, string> = {
        overview: `다음 공종에 대한 작업 개요를 JSON으로 작성해라:\n공종: ${process_name}\n출력 형식: {"work_name":"","work_date":"","work_location":"","work_content":"상세 작업내용","supervisor":"","workers_count":""}`,
        method: `다음 공종의 작업 절차를 단계별로 JSON 배열로 작성해라:\n공종: ${process_name}\n각 단계에 안전조치를 반드시 포함해라.\n출력 형식: [{"order":1,"description":"작업단계","safety_measure":"안전조치"}]\n최소 5단계 이상 작성.`,
        risk: `다음 공종의 위험요인과 안전대책을 JSON 배열로 작성해라:\n공종: ${process_name}\n위험요인은 "원인 + 사고결과" 구조로 작성. 안전대책은 실행 가능한 구체적 조치.\n출력 형식: [{"hazard":"위험요인","situation":"발생상황","measure":"안전대책","severity":"상/중/하"}]\n최소 8개 이상 작성.`,
        signal: `다음 공종의 신호체계를 JSON으로 작성해라:\n공종: ${process_name}\n출력 형식: {"signal_person":"신호수 자격요건","signal_method":"무전기","radio_channel":"CH-5","hand_signals":"수신호 약속 상세","emergency_signal":"비상정지 신호"}`,
        emergency: `다음 공종의 비상시 조치계획을 JSON으로 작성해라:\n공종: ${process_name}\n출력 형식: {"emergency_contact":"119, 현장소장","hospital":"인근병원","evacuation_route":"대피경로","assembly_point":"집결장소","first_aid":"응급처치계획","reporting_procedure":"보고체계"}`,
        equipment: `다음 공종에 필요한 장비 목록을 JSON 배열로 작성해라:\n공종: ${process_name}\n출력 형식: [{"name":"장비명","model":"모델명","capacity":"정격하중/용량","manufacturer":"","inspection_date":""}]\n최소 3개 이상.`,
      };

      const prompt =
        sectionPrompts[section_key || ""] ||
        `다음 공종의 "${section_title}" 내용을 전문적으로 작성해라:\n공종: ${process_name}\nJSON으로 출력 불가 시 텍스트로 작성.`;

      const sysPrompt = `너는 대한민국 건설현장 20년 경력의 안전관리 전문가다.\n산업안전보건법, KOSHA GUIDE 기준으로 실제 현장에서 사용 가능한 수준의 작업계획서를 작성한다.\n반드시 요청된 JSON 형식으로만 출력하라.`;

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: useOpenAI ? openaiModel : "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: sysPrompt },
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

      try {
        const jsonMatch = content.match(/[\[{][\s\S]*[\]}]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          return new Response(JSON.stringify({ structured: parsed }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch {
        console.log("[WorkPlan AI] JSON parse failed, returning as text");
      }

      return new Response(
        JSON.stringify({ content: content.replace(/```[\s\S]*?```/g, "").trim() }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ============ Risk Assessment Mode ============
    const normalizedEquipment = normalizeEquipment(equipment || "");
    const locationText = work_location || "일반";
    const envText =
      work_environment && work_environment.length > 0
        ? work_environment.join(", ")
        : "일반 작업 환경";
    const equipText = normalizedEquipment || "없음";
    const descText = work_description || process_name + " 관련 작업";
    const totalCount = target_count || 30;

    // ── Cache check ──
    const cacheKey = `${process_name}|${equipText}|${descText}|${locationText}|${envText}`
      .toLowerCase()
      .trim();

    // If this is not a batch request (batch_index undefined), check cache first
    if (batch_index === undefined || batch_index === null) {
      const { data: cached } = await adminClient
        .from("ai_risk_cache")
        .select("*")
        .eq("cache_key", cacheKey)
        .maybeSingle();

      if (cached && Array.isArray(cached.generated_items) && (cached.generated_items as any[]).length > 3) {
        console.log(`[AI Engine] Cache hit: ${(cached.generated_items as any[]).length} items`);
        await adminClient
          .from("ai_risk_cache")
          .update({ hit_count: (cached.hit_count || 0) + 1 })
          .eq("id", cached.id);

        return new Response(
          JSON.stringify({
            items: (cached.generated_items as any[]).slice(0, totalCount),
            source: "cache",
            count: Math.min((cached.generated_items as any[]).length, totalCount),
            normalized_equipment: normalizedEquipment,
            total_batches: 1,
            batch_index: 0,
            is_complete: true,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // ── RAG context ──
    console.log("[AI Engine] Fetching RAG context...");
    const ragContext = await fetchRAGContext(adminClient, process_name, equipText);
    console.log(`[AI Engine] RAG context: ${ragContext ? ragContext.split("\n").length - 1 : 0} items`);

    // ── Chunked generation ──
    const currentBatchIndex = batch_index ?? 0;
    const batchSizeVal = batch_size ?? Math.min(8, totalCount);
    const totalBatches = Math.ceil(totalCount / batchSizeVal);
    const currentBatchSize = Math.min(batchSizeVal, totalCount - currentBatchIndex * batchSizeVal);

    if (currentBatchSize <= 0) {
      return new Response(
        JSON.stringify({ items: [], source: "ai", count: 0, is_complete: true, batch_index: currentBatchIndex, total_batches: totalBatches }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const defaultModel = useOpenAI ? openaiModel : "google/gemini-2.5-flash";

    console.log(`[AI Engine] Generating batch ${currentBatchIndex + 1}/${totalBatches} (${currentBatchSize} items)`);

    const rawItems = await generateBatch(
      apiUrl,
      apiKey!,
      defaultModel,
      process_name,
      equipText,
      descText,
      locationText,
      envText,
      currentBatchSize,
      ragContext,
      currentBatchIndex
    );

    const existingKeys = new Set<string>();
    const deduped = mapAndDedupe(rawItems, process_name, existingKeys);

    const isComplete = currentBatchIndex + 1 >= totalBatches;

    // Cache on final batch (or single-batch request)
    if (isComplete && deduped.length > 0) {
      await adminClient.from("ai_risk_cache").upsert(
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
    }

    return new Response(
      JSON.stringify({
        items: deduped,
        source: "ai",
        count: deduped.length,
        normalized_equipment: normalizedEquipment,
        batch_index: currentBatchIndex,
        total_batches: totalBatches,
        is_complete: isComplete,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("generate-risk-ai error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg === "RATE_LIMIT") {
      return new Response(JSON.stringify({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (msg === "CREDITS_EXHAUSTED") {
      return new Response(JSON.stringify({ error: "AI 크레딧이 부족합니다. 워크스페이스 크레딧을 충전해주세요." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
