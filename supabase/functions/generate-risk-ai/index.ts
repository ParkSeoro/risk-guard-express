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

// ── Generate risk items using detail_level (no forced count) ──
async function generateRiskAssessment(
  processName: string,
  equipText: string,
  descText: string,
  locationText: string,
  envText: string,
  detailLevel: 'core' | 'comprehensive',
  ragContext: string,
): Promise<{ items: any[]; accident_cases: any[] }> {
  const systemPrompt = `당신은 대한민국 1군 건설사 및 최고 수준의 발주처(안전관리자) 관점의 위험성평가 전문가입니다.
최근 개정된 산업안전보건법 위험성평가 지침과 「산업안전보건기준에 관한 규칙」·KOSHA GUIDE·중대재해처벌법을 기준으로,
입력된 공종에 대해 매우 디테일하고 실질적인 유해·위험요인을 도출해야 합니다.

[핵심 작성 지시]
1. 단순히 뭉뚱그려 평가하지 말고, 해당 공종을 3~5개의 세부 작업 순서(예: 작업 전 준비 → 본 작업 → 마무리, 필요 시 반입·양중·해체 등)로 쪼갠 뒤, 각 단계별로 발생할 수 있는 구체적인 위험요인과 개선대책을 작성하십시오.
2. 항목 수는 최소 15개 이상 촘촘하게 작성하십시오. (핵심 모드도 15개 전후, 상세 모드는 20~35개)
3. '추락 위험 있음' 같은 뻔한 문구 금지. 반드시 '비계 단부에서 자재 인양 중 작업자 안전대 미체결로 인한 추락'처럼 원인·상황·결과가 드러나는 구체 시나리오로 명시하십시오.
4. 개선대책은 본질안전(제거·대체) → 공학적(방호·격리·환기) → 관리적(작업허가·교육·표지) → PPE 순으로 실행 가능하게 서술. PPE만 단독 나열 금지.
5. 위험도 분포는 상 20~30% / 중 40~60% / 하 10~30%로 자연스럽게 배분.
6. 법적근거는 산안기준규칙 조항 또는 KOSHA GUIDE 코드 등 실제 관련 근거만.

[사고사례 출력 제한]
과거 사고사례는 사용자에게 경각심을 주되 너무 길어지면 안 됩니다.
입력된 공종·장비·환경과 가장 밀접한 치명적인 실제 사고사례를 딱 2~3개만, 발생원인과 결과 위주로 짧게 요약해 제공하십시오.

[출력 규칙]
- 출력은 오직 JSON 객체 하나뿐. 코드펜스·설명문 절대 금지.
- 100% 한국어. (TBM/KOSHA/PPE 등 고유명사 병기만 허용)
- 반드시 완결된 JSON을 반환. 중간에 끊지 말 것.
- 어투는 단정형(~함, ~할 것).`;

  const levelInstruction = detailLevel === 'core'
    ? `[요청 수준: 핵심]
- 중대재해 유발 가능성이 높은 핵심 항목 중심으로 최소 15개 작성.
- 세부 작업 단계는 3개 이상(준비·본작업·마무리)으로 나누고 단계마다 항목을 배치.`
    : `[요청 수준: 작업 순서별 상세]
- 세부 작업 순서 3~5단계로 분해한 뒤, 단계별·4M(사람·기계·물질/환경·관리) 관점으로 최소 15개 이상(권장 20~35개) 촘촘히 작성.
- 실효성 없는 중복·상투어로 개수를 부풀리지 말 것.`;

  const userPrompt = `[입력 정보]
공종: ${processName}
장비: ${equipText}
작업내용: ${descText}
작업위치: ${locationText}
작업조건/환경: ${envText}
${ragContext}

${levelInstruction}

[출력 형식 - JSON 객체만]
{
  "items": [
    {
      "공정": "${processName}",
      "세부작업": "시공 순서상의 세부 작업 단계명",
      "위험요인": "원인 + 사고결과가 드러나는 구체 문장",
      "발생상황": "실제 작업 단계에서의 구체 시나리오",
      "기존대책": "현재 통상 적용되는 대책",
      "개선대책": "본질안전 → 공학적 → 관리적 → PPE 순의 구체 대책",
      "위험도": "상|중|하",
      "심각도": "상|중|하",
      "개선후위험도": "상|중|하",
      "개선후심각도": "상|중|하",
      "보호구": ["안전모", "안전대"],
      "법적근거": "산업안전보건기준에 관한 규칙 제OO조 또는 KOSHA GUIDE C-OO"
    }
  ],
  "accident_cases": [
    {
      "title": "사고 한줄 제목",
      "cause": "발생원인 요약",
      "result": "결과(사상·피해) 요약"
    }
  ]
}
※ items는 최소 15개. accident_cases는 정확히 2~3개만.`;

  const response = await geminiChatFetch({
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.35,
    max_tokens: 8192,
    response_format: { type: "json_object" },
  });

  if (!response.ok) {
    const status = response.status;
    const text = await response.text();
    console.error(`[RiskGen] AI error:`, status, text);
    if (status === 429) throw new Error("RATE_LIMIT");
    if (status === 402) throw new Error("CREDITS_EXHAUSTED");
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
    const cacheKey = `v2|${process_name}|${equipText}|${descText}|${locationText}|${envText}|${detailLevel}`
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
    const cacheMin = 15;
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

    // ── RAG context ──
    console.log("[AI Engine] Fetching RAG context...");
    const ragContext = await fetchRAGContext(adminClient, process_name, equipText);
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

    if (deduped.length > 0) {
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
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
