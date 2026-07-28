import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChatFetch } from "../_shared/gemini.ts";

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

// ── Format structured JSON into a Korean-readable paragraph ──
// Used so downstream text consumers (preview, plain-text sections) never
// see raw JSON like {"workPlan":...} or English keys.
const KO_LABELS: Record<string, string> = {
  work_name: "작업명", work_date: "작업일시", work_location: "작업위치",
  work_content: "작업내용", supervisor: "현장감독자", workers_count: "투입인원",
  name: "장비명", model: "모델명", capacity: "정격하중", manufacturer: "제조사",
  inspection_date: "검사일", order: "순서", description: "작업단계",
  safety_measure: "안전조치", hazard: "위험요인", situation: "발생상황",
  measure: "안전대책", severity: "위험도", signal_person: "신호수",
  signal_method: "신호방식", radio_channel: "무전 채널", hand_signals: "수신호",
  emergency_signal: "비상정지 신호", emergency_contact: "비상연락처",
  hospital: "인근병원", evacuation_route: "대피경로", assembly_point: "집결장소",
  first_aid: "응급처치", reporting_procedure: "보고체계",
  workPlan: "작업계획", workAreaName: "작업장소", workPathName: "운행경로",
};
function formatStructuredToKorean(_sectionKey: string, data: any): string {
  const render = (val: any): string => {
    if (val === null || val === undefined || val === "") return "";
    if (typeof val === "string" || typeof val === "number") return String(val);
    if (Array.isArray(val)) {
      return val.map((item, i) => {
        if (typeof item === "object" && item !== null) {
          const parts = Object.entries(item)
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => `${KO_LABELS[k] || k}: ${render(v)}`);
          return `${i + 1}. ${parts.join(" / ")}`;
        }
        return `${i + 1}. ${render(item)}`;
      }).join("\n");
    }
    if (typeof val === "object") {
      return Object.entries(val)
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => `• ${KO_LABELS[k] || k}: ${render(v)}`)
        .join("\n");
    }
    return "";
  };
  return render(data);
}

// ── RAG: fetch similar items from existing data (parallel, capped) ──
// Keep this cheap — sequential multi-query RAG previously burned wall-clock
// before the LLM call and contributed to WORKER_RESOURCE_LIMIT (HTTP 546).
async function fetchRAGContext(
  adminClient: any,
  processName: string,
  equipment: string,
  limit = 5
): Promise<string> {
  const keywords = processName
    .split(/[\s,/·]+/)
    .filter((w: string) => w.length >= 2)
    .slice(0, 2);

  const primaryKw = keywords[0] || processName;
  const queries: PromiseLike<{ data: any[] | null }>[] = [];

  if (primaryKw) {
    queries.push(
      adminClient
        .from("standard_risk_library")
        .select("sub_task, hazard, hazard_situation, existing_measure, improvement_measure")
        .or(`category_large.ilike.%${primaryKw}%,sub_task.ilike.%${primaryKw}%`)
        .eq("is_active", true)
        .limit(5),
    );
    queries.push(
      adminClient
        .from("risk_items")
        .select("sub_task, hazard, hazard_situation, existing_measure, improvement_measure")
        .ilike("process", `%${primaryKw}%`)
        .limit(5),
    );
  }

  if (equipment) {
    const normEquip = normalizeEquipment(equipment);
    const equipKw = normEquip.split(/[()/\s]+/).filter((w: string) => w.length >= 2)[0];
    if (equipKw) {
      queries.push(
        adminClient
          .from("standard_risk_library")
          .select("sub_task, hazard, hazard_situation, existing_measure, improvement_measure")
          .contains("equipment", [equipKw])
          .eq("is_active", true)
          .limit(3),
      );
    }
  }

  const results = await Promise.all(queries);
  const ragItems: any[] = [];
  for (const r of results) {
    if (r?.data) ragItems.push(...r.data);
  }

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
      `${i + 1}. 세부작업: ${item.sub_task || ""}, 위험요인: ${item.hazard || ""}, 발생상황: ${item.hazard_situation || ""}, 개선대책: ${item.improvement_measure || item.existing_measure || ""}`
  );

  return `\n[참고 사례]\n${lines.join("\n")}`;
}

// ── Generate risk items using detail_level (no forced count) ──
// Token budget is intentionally capped: Edge workers hit WORKER_RESOURCE_LIMIT
// (~150s wall) when asking for 20~35 long items with max_tokens=8192.
async function generateRiskAssessment(
  processName: string,
  equipText: string,
  descText: string,
  locationText: string,
  envText: string,
  detailLevel: 'core' | 'comprehensive',
  ragContext: string,
): Promise<{ items: any[]; accident_cases: any[] }> {
  const targetCount = detailLevel === 'core' ? 15 : 18;
  const maxTokens = detailLevel === 'core' ? 3600 : 4500;

  const systemPrompt = `/no_think
당신은 건설현장 위험성평가 전문가다. 산안법·산안기준규칙·KOSHA GUIDE 기준으로 작성한다.
[작성 규칙]
1. 공종을 준비→본작업→마무리(필요 시 반입·양중) 등 3단계 이상으로 쪼갠 뒤 단계별 위험요인을 작성.
2. 항목 수는 정확히 ${targetCount}개. 중복·상투어 금지. 각 문장은 짧게(위험요인·발생상황·대책 각 1문장).
3. '추락 위험 있음' 금지. 원인·상황·결과가 드러나는 구체 시나리오.
4. 개선대책: 본질안전→공학적→관리적→PPE 순. PPE만 나열 금지.
5. 위험도 분포: 상 20~30% / 중 40~60% / 하 10~30%.
6. 법적근거는 관련 조항·KOSHA 코드만. 출력은 JSON 객체 하나뿐. 한국어 단정형.`;

  const levelInstruction = detailLevel === 'core'
    ? `[요청 수준: 핵심] 중대재해 가능성이 높은 항목 ${targetCount}개.`
    : `[요청 수준: 상세] 단계별·4M 관점으로 ${targetCount}개. 문장은 짧게 유지.`;

  const userPrompt = `[입력]
공종: ${processName}
장비: ${equipText}
작업내용: ${descText}
작업위치: ${locationText}
작업조건/환경: ${envText}
${ragContext}

${levelInstruction}

[출력 JSON]
{"items":[{"공정":"${processName}","세부작업":"","위험요인":"","발생상황":"","기존대책":"","개선대책":"","위험도":"중","심각도":"중","개선후위험도":"하","개선후심각도":"하","보호구":["안전모"],"법적근거":""}],"accident_cases":[{"title":"","cause":"","result":""}]}
※ items 정확히 ${targetCount}개, accident_cases 2개. 완결된 JSON만.`;

  const response = await geminiChatFetch({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: maxTokens,
    response_format: { type: "json_object" },
    compact: true,
  });

  if (!response.ok) {
    const status = response.status;
    const text = await response.text();
    console.error(`[RiskGen] AI error:`, status, text);
    if (status === 429) throw new Error("RATE_LIMIT");
    if (status === 402) throw new Error("CREDITS_EXHAUSTED");
    if (status === 403) throw new Error("INVALID_KEY");
    throw new Error(`AI_ERROR_${status}`);
  }

  const result = await response.json();
  const raw = result.choices?.[0]?.message?.content || "";
  const content = raw.replace(/```json/gi, "").replace(/```/g, "").trim();

  const tryParse = (s: string): any => {
    try { return JSON.parse(s); } catch { return null; }
  };

  let parsed = tryParse(content);
  if (!parsed) {
    const objMatch = content.match(/\{[\s\S]*\}/);
    if (objMatch) parsed = tryParse(objMatch[0]);
  }
  if (!parsed) {
    const arrMatch = content.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      const arr = tryParse(arrMatch[0]);
      if (Array.isArray(arr)) return { items: arr, accident_cases: [] };
    }
  }

  if (Array.isArray(parsed)) {
    return { items: parsed, accident_cases: [] };
  }

  if (parsed && typeof parsed === "object") {
    const items = Array.isArray(parsed.items)
      ? parsed.items
      : (Array.isArray(parsed["위험요인목록"]) ? parsed["위험요인목록"] : []);
    let accident_cases = Array.isArray(parsed.accident_cases)
      ? parsed.accident_cases
      : (Array.isArray(parsed["사고사례"]) ? parsed["사고사례"] : []);
    // Normalize accident case keys (KO/EN)
    accident_cases = accident_cases.slice(0, 3).map((c: any) => ({
      title: c.title || c["제목"] || c["사고명"] || "",
      cause: c.cause || c["원인"] || c["발생원인"] || "",
      result: c.result || c["결과"] || c["피해"] || "",
    })).filter((c: any) => c.title || c.cause);
    if (accident_cases.length > 3) accident_cases = accident_cases.slice(0, 3);
    if (items.length > 0) return { items, accident_cases };

    // Repair truncated items array inside object
    const itemsStart = content.indexOf('"items"');
    if (itemsStart >= 0) {
      const fromItems = content.slice(itemsStart);
      const bracket = fromItems.indexOf("[");
      if (bracket >= 0) {
        const tail = fromItems.slice(bracket);
        const lastObjEnd = tail.lastIndexOf("},");
        if (lastObjEnd > 0) {
          const repaired = tail.slice(0, lastObjEnd + 1) + "]";
          const repairedArr = tryParse(repaired);
          if (Array.isArray(repairedArr) && repairedArr.length > 0) {
            console.warn(`[RiskGen] Repaired truncated items (${repairedArr.length})`);
            return { items: repairedArr, accident_cases };
          }
        }
      }
    }
  }

  console.error(`[RiskGen] JSON parse failed. Head:`, content.slice(0, 300));
  return { items: [], accident_cases: [] };
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
    // GEMINI_API_KEY is read inside callGeminiChat helper; no local cache needed.
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
      detail_level,
      project_id,
    } = body;
    // detail_level: 'core' | 'comprehensive' — replaces the removed target_count.
    const detailLevel: 'core' | 'comprehensive' =
      detail_level === 'core' ? 'core' : 'comprehensive';

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

      const response = await geminiChatFetch({
        messages: [
          { role: "system", content: sysPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
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
      const rawContent = result.choices?.[0]?.message?.content || "";
      // Defensive: strip any residual ```json fences.
      const content = rawContent.replace(/```json/gi, "").replace(/```/g, "").trim();

      try {
        const jsonMatch = content.match(/[\[{][\s\S]*[\]}]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          // Also produce a Korean-readable text form for preview/plain-text consumers.
          const koreanText = formatStructuredToKorean(section_key || "", parsed);
          return new Response(JSON.stringify({ structured: parsed, content: koreanText }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch {
        console.log("[WorkPlan AI] JSON parse failed, returning as text");
      }

      return new Response(
        JSON.stringify({ content }),
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

    // ── Cache check (keyed by inputs + detail level + prompt version) ──
    // v3: lighter prompt / capped item count (avoids WORKER_RESOURCE_LIMIT)
    const cacheKey = `v3|${process_name}|${equipText}|${descText}|${locationText}|${envText}|${detailLevel}`
      .toLowerCase()
      .trim();

    const { data: cached } = await adminClient
      .from("ai_risk_cache")
      .select("*")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    const cachedItems = (cached?.generated_items as any[]) || [];
    const cachedAccidents = Array.isArray((cached as any)?.accident_cases)
      ? (cached as any).accident_cases
      : [];
    const cacheMin = detailLevel === 'core' ? 12 : 15;
    if (cached && Array.isArray(cachedItems) && cachedItems.length >= cacheMin) {
      console.log(`[AI Engine] Cache hit: ${cachedItems.length} items (detail=${detailLevel})`);
      await adminClient
        .from("ai_risk_cache")
        .update({ hit_count: (cached.hit_count || 0) + 1 })
        .eq("id", cached.id);

      return new Response(
        JSON.stringify({
          items: cachedItems,
          accident_cases: cachedAccidents.slice(0, 3),
          source: "cache",
          count: cachedItems.length,
          normalized_equipment: normalizedEquipment,
          detail_level: detailLevel,
          is_complete: true,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── RAG context (budgeted) ──
    console.log("[AI Engine] Fetching RAG context...");
    const ragContext = await fetchRAGContext(adminClient, process_name, equipText, 5);
    console.log(`[AI Engine] RAG context: ${ragContext ? ragContext.split("\n").length - 1 : 0} items`);

    console.log(`[AI Engine] Generating risk assessment (detail=${detailLevel})`);
    const generated = await generateRiskAssessment(
      process_name,
      equipText,
      descText,
      locationText,
      envText,
      detailLevel,
      ragContext,
    );

    const existingKeys = new Set<string>();
    const deduped = mapAndDedupe(generated.items || [], process_name, existingKeys);
    const accidentCases = (generated.accident_cases || []).slice(0, 3);

    if (deduped.length === 0) {
      return new Response(
        JSON.stringify({
          error: "AI가 유효한 위험성평가 항목을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.",
          items: [],
          count: 0,
        }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Cache write is best-effort — never fail the response because of it
    const { error: cacheErr } = await adminClient.from("ai_risk_cache").upsert(
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
    if (cacheErr) {
      console.warn("[AI Engine] cache upsert skipped:", cacheErr.message || cacheErr);
    }

    return new Response(
      JSON.stringify({
        items: deduped,
        accident_cases: accidentCases,
        source: "ai",
        count: deduped.length,
        normalized_equipment: normalizedEquipment,
        detail_level: detailLevel,
        is_complete: true,
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
    if (msg === "INVALID_KEY") {
      return new Response(JSON.stringify({ error: "AI API 키가 유효하지 않습니다. 마스터가 설정 > 시크릿에서 확인해야 합니다." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(
      JSON.stringify({ error: msg.startsWith("AI_ERROR_") ? "AI 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요." : msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
