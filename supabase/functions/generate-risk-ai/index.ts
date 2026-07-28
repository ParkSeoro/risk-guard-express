import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChatFetch, streamGeminiChatText, GeminiError } from "../_shared/gemini.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const sseHeaders = {
  ...corsHeaders,
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  "Connection": "keep-alive",
  "X-Content-Type-Options": "nosniff",
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

async function fetchRAGContext(
  adminClient: any,
  processName: string,
  equipment: string,
  limit = 5,
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
      `${i + 1}. 세부작업: ${item.sub_task || ""}, 위험요인: ${item.hazard || ""}, 발생상황: ${item.hazard_situation || ""}, 개선대책: ${item.improvement_measure || item.existing_measure || ""}`,
  );
  return `\n[참고 사례]\n${lines.join("\n")}`;
}

const HSE_SYSTEM_PROMPT = `/no_think
너는 20년 경력의 대한민국 건설현장 최고 안전보건전문가(HSE)다.
공정별 위험성평가를 작성할 때, 사용자가 나중에 불필요한 것을 지우더라도 **최대한 가혹하고 디테일하게 모든 잠재적 위험 요인을 도출**해야 한다.

[절대 규칙]
1. [위험발생상황]·[기존대책]·[개선대책]은 절대 빈칸(null, '-', '없음', '')으로 두지 말고 구체 시나리오와 실행 가능한 방안을 서술할 것.
2. [위험도(가능성)]와 [심각도(중대성)]는 무조건 '하'로 주지 말 것. 추락·협착·감전·질식·붕괴·화재·중장비 충돌 등 치명 재해는 반드시 '상' 또는 '중'으로 엄격 평가.
3. '추락 위험 있음' 같은 상투어 금지. 원인·상황·결과가 드러나는 구체 문장으로 작성.
4. 개선대책은 본질안전(제거·대체) → 공학적(방호·격리·환기) → 관리적(작업허가·교육·표지) → PPE 순. PPE만 나열 금지.
5. 법적근거는 산안법·산안기준규칙 조항 또는 KOSHA GUIDE 코드 등 실제 근거만.
6. 출력은 오직 JSON. 코드펜스·설명문 금지. 100% 한국어 단정형(~함, ~할 것).`;

type PhaseDef = {
  id: string;
  title: string;
  focus: string;
  targetCount: number;
  includeAccidents?: boolean;
};

function buildPhases(detailLevel: "core" | "comprehensive"): PhaseDef[] {
  if (detailLevel === "core") {
    return [
      {
        id: "prep",
        title: "작업 전 준비",
        focus: "작업허가·장비점검·지장물·환기·보호구·신호체계·작업구역 통제",
        targetCount: 6,
      },
      {
        id: "main",
        title: "본 작업",
        focus: "본작업 중 추락·협착·붕괴·감전·충돌·유해물질 등 4M 관점 치명 위험",
        targetCount: 8,
      },
      {
        id: "finish",
        title: "마무리·비상",
        focus: "철수·정리·잔여위험·비상조치·복구",
        targetCount: 5,
        includeAccidents: true,
      },
    ];
  }
  return [
    {
      id: "prep",
      title: "작업 전 준비·반입",
      focus: "사전조사·작업허가·장비반입·양중·지장물·환기측정·보호구·신호수·구역통제",
      targetCount: 8,
    },
    {
      id: "main",
      title: "본 작업",
      focus: "단계별 본작업·장비운용·인력교차·구조적 위험·환경·관리 미비",
      targetCount: 12,
    },
    {
      id: "finish",
      title: "마무리·해체·비상",
      focus: "해체·되메우기·잔재처리·점검·비상연락·대피",
      targetCount: 8,
      includeAccidents: true,
    },
  ];
}

function tryParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Extract newly completed JSON objects from a growing `items` array buffer. */
function extractCompletedObjects(buffer: string, alreadyEmitted: number): { objects: any[]; nextIndex: number } {
  const cleaned = buffer.replace(/```json/gi, "").replace(/```/g, "");
  const itemsKey = cleaned.search(/"items"\s*:/);
  let arrStart = -1;
  if (itemsKey >= 0) {
    arrStart = cleaned.indexOf("[", itemsKey);
  } else {
    arrStart = cleaned.indexOf("[");
  }
  if (arrStart < 0) return { objects: [], nextIndex: alreadyEmitted };

  const arrBody = cleaned.slice(arrStart + 1);
  const objects: any[] = [];
  let depth = 0;
  let inString = false;
  let escape = false;
  let objStart = -1;
  let completed = 0;

  for (let i = 0; i < arrBody.length; i++) {
    const ch = arrBody[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      if (depth === 0) objStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && objStart >= 0) {
        completed++;
        if (completed > alreadyEmitted) {
          const rawObj = arrBody.slice(objStart, i + 1);
          const parsed = tryParse(rawObj);
          if (parsed && typeof parsed === "object") objects.push(parsed);
        }
        objStart = -1;
      }
    } else if (ch === "]" && depth === 0) {
      break;
    }
  }
  return { objects, nextIndex: alreadyEmitted + objects.length };
}

function extractAccidentCases(buffer: string): any[] {
  const cleaned = buffer.replace(/```json/gi, "").replace(/```/g, "");
  const m = cleaned.match(/"accident_cases"\s*:\s*(\[[\s\S]*?\])/);
  if (!m) {
    const m2 = cleaned.match(/"사고사례"\s*:\s*(\[[\s\S]*?\])/);
    if (!m2) return [];
    const arr = tryParse(m2[1]);
    return Array.isArray(arr) ? arr : [];
  }
  const arr = tryParse(m[1]);
  return Array.isArray(arr) ? arr : [];
}

function mapRawItem(item: any, processName: string): any | null {
  const blank = (v: any) => {
    const s = String(v ?? "").trim();
    return !s || s === "-" || s === "없음" || s.toLowerCase() === "null";
  };

  const sub_task = String(item["세부작업"] || item.sub_task || "").trim();
  const hazard = String(item["위험요인"] || item.hazard || "").trim();
  let hazard_situation = String(item["발생상황"] || item.hazard_situation || "").trim();
  let existing_measure = String(item["기존대책"] || item.existing_measure || "").trim();
  let improvement_measure = String(item["개선대책"] || item.improvement_measure || "").trim();

  if (!sub_task || !hazard) return null;

  // Soft-fill blanks rather than dropping high-value hazards
  if (blank(hazard_situation)) {
    hazard_situation = `${sub_task} 수행 중 ${hazard}이(가) 발생할 수 있는 구체 상황`;
  }
  if (blank(existing_measure)) {
    existing_measure = "작업전 TBM·개인보호구 착용·관리감독자 순회점검 등 통상 조치";
  }
  if (blank(improvement_measure)) {
    improvement_measure =
      "위험원 제거·대체 검토 → 방호·격리 등 공학적 조치 → 작업허가·전담감시 → 적합 PPE 착용 및 교육";
  }

  let likelihood = String(item["위험도"] || item.likelihood_grade || "중").trim();
  let severity = String(item["심각도"] || item.severity_grade || "중").trim();
  if (!["상", "중", "하"].includes(likelihood)) likelihood = "중";
  if (!["상", "중", "하"].includes(severity)) severity = "중";

  // Fatal keywords must not stay at 하
  const fatalRe = /추락|협착|끼임|감전|질식|붕괴|도괴|화재|폭발|중장비|충돌|낙하|비래/;
  if (fatalRe.test(hazard) || fatalRe.test(hazard_situation)) {
    if (likelihood === "하") likelihood = "중";
    if (severity === "하") severity = "상";
  }

  const ppeRaw = item["보호구"] ?? item.ppe ?? [];
  const ppe = Array.isArray(ppeRaw) ? ppeRaw.map(String).filter(Boolean) : String(ppeRaw).split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const legalRaw = item["법적근거"] ?? item.legal_basis ?? "";
  const legal_basis = Array.isArray(legalRaw)
    ? legalRaw.map(String).filter(Boolean)
    : String(legalRaw).trim()
    ? [String(legalRaw).trim()]
    : [];

  return {
    process: String(item["공정"] || item.process || processName),
    sub_task,
    hazard,
    hazard_situation,
    existing_measure,
    improvement_measure,
    likelihood_grade: likelihood,
    severity_grade: severity,
    improved_likelihood_grade: ["상", "중", "하"].includes(item["개선후위험도"] || item.improved_likelihood_grade)
      ? (item["개선후위험도"] || item.improved_likelihood_grade)
      : "하",
    improved_severity_grade: ["상", "중", "하"].includes(item["개선후심각도"] || item.improved_severity_grade)
      ? (item["개선후심각도"] || item.improved_severity_grade)
      : "하",
    ppe: ppe.length ? ppe : ["안전모", "안전화"],
    legal_basis,
  };
}

function mapAndDedupe(items: any[], processName: string, existingKeys: Set<string>): any[] {
  const out: any[] = [];
  for (const raw of items) {
    const mapped = mapRawItem(raw, processName);
    if (!mapped) continue;
    const key = `${mapped.sub_task}|${mapped.hazard}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    out.push(mapped);
  }
  return out;
}

function normalizeAccidents(raw: any[]): any[] {
  return raw
    .slice(0, 3)
    .map((c: any) => ({
      title: c.title || c["제목"] || c["사고명"] || "",
      cause: c.cause || c["원인"] || c["발생원인"] || "",
      result: c.result || c["결과"] || c["피해"] || "",
    }))
    .filter((c) => c.title || c.cause);
}

function sseEncode(encoder: TextEncoder, payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

async function streamPhaseItems(
  processName: string,
  equipText: string,
  descText: string,
  locationText: string,
  envText: string,
  ragContext: string,
  phase: PhaseDef,
  onDeltaItem: (raw: any) => void,
): Promise<{ rawItems: any[]; accidents: any[] }> {
  const accidentClause = phase.includeAccidents
    ? `\n또한 accident_cases에 관련 치명 사고사례를 정확히 2~3개(title/cause/result) 짧게 포함.`
    : `\naccident_cases는 빈 배열 [].`;

  const userPrompt = `[입력]
공종: ${processName}
장비: ${equipText}
작업내용: ${descText}
작업위치: ${locationText}
작업조건/환경: ${envText}
${ragContext}

[이번 배치 — ${phase.title}]
초점: ${phase.focus}
items를 최소 ${phase.targetCount}개 이상, 가능하면 ${phase.targetCount + 2}개까지 과하게라도 디테일하게 도출.
각 항목의 발생상황·기존대책·개선대책은 2문장 수준으로 구체 서술. 빈칸 금지.
치명 재해(추락·협착·감전·질식·붕괴 등)는 위험도/심각도를 상 또는 중으로.
${accidentClause}

[출력 JSON]
{"items":[{"공정":"${processName}","세부작업":"${phase.title} 관련 세부작업명","위험요인":"원인+결과 구체 문장","발생상황":"구체 시나리오","기존대책":"현재 통상 대책","개선대책":"본질안전→공학적→관리적→PPE","위험도":"상|중|하","심각도":"상|중|하","개선후위험도":"하","개선후심각도":"하","보호구":["안전모","안전화"],"법적근거":"산안기준규칙 제OO조 또는 KOSHA GUIDE"}],"accident_cases":[{"title":"","cause":"","result":""}]}`;

  let buffer = "";
  let emitted = 0;
  const collected: any[] = [];

  for await (const chunk of streamGeminiChatText({
    messages: [
      { role: "system", content: HSE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.4,
    max_tokens: 4500,
    response_format: { type: "json_object" },
    compact: true, // HSE prompt already embeds full rules
  })) {
    buffer += chunk;
    const { objects, nextIndex } = extractCompletedObjects(buffer, emitted);
    for (const obj of objects) {
      collected.push(obj);
      onDeltaItem(obj);
    }
    emitted = nextIndex;
  }

  // Final parse pass for any remaining complete JSON
  const finalParsed = tryParse(buffer.replace(/```json/gi, "").replace(/```/g, "").trim()) ||
    (() => {
      const m = buffer.match(/\{[\s\S]*\}/);
      return m ? tryParse(m[0]) : null;
    })();

  if (finalParsed?.items && Array.isArray(finalParsed.items)) {
    for (let i = emitted; i < finalParsed.items.length; i++) {
      collected.push(finalParsed.items[i]);
      onDeltaItem(finalParsed.items[i]);
    }
  }

  const accidents = phase.includeAccidents
    ? normalizeAccidents(
      Array.isArray(finalParsed?.accident_cases)
        ? finalParsed.accident_cases
        : extractAccidentCases(buffer),
    )
    : [];

  return { rawItems: collected.length ? collected : (finalParsed?.items || []), accidents };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const adminClient = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });
    }
    const token = authHeader.slice(7);
    const isInternal = token === supabaseKey;
    if (!isInternal) {
      const userSb = createClient(supabaseUrl, anonKey);
      const { data: claims, error: claimErr } = await userSb.auth.getClaims(token);
      if (claimErr || !claims?.claims?.sub) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        });
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
      stream: streamFlag,
    } = body;

    const detailLevel: "core" | "comprehensive" =
      detail_level === "core" ? "core" : "comprehensive";
    const wantStream = streamFlag !== false; // default ON for risk mode

    if (!isInternal && project_id) {
      const userSb = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: claimsData } = await userSb.auth.getClaims(token);
      const { data: isMember } = await userSb.rpc("is_project_member", {
        _user_id: claimsData!.claims.sub,
        _project_id: project_id,
      });
      if (!isMember) {
        return new Response(JSON.stringify({ error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        });
      }
    }

    if (!process_name) {
      return new Response(JSON.stringify({ error: "공종명이 필요합니다." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });
    }

    // ============ Work Plan Section Mode (non-stream JSON) ============
    if (mode === "work_plan_section") {
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

      const sysPrompt =
        `너는 대한민국 건설현장 20년 경력의 안전관리 전문가다.\n산업안전보건법, KOSHA GUIDE 기준으로 실제 현장에서 사용 가능한 수준의 작업계획서를 작성한다.\n반드시 요청된 JSON 형식으로만 출력하라.`;

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
        if (status === 429) {
          return new Response(JSON.stringify({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
          });
        }
        if (status === 402) {
          return new Response(JSON.stringify({ error: "AI 크레딧이 부족합니다." }), {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
          });
        }
        return new Response(JSON.stringify({ error: "AI 생성 오류", detail: text }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        });
      }

      const result = await response.json();
      const rawContent = result.choices?.[0]?.message?.content || "";
      const content = rawContent.replace(/```json/gi, "").replace(/```/g, "").trim();

      try {
        const jsonMatch = content.match(/[\[{][\s\S]*[\]}]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          const koreanText = formatStructuredToKorean(section_key || "", parsed);
          return new Response(JSON.stringify({ structured: parsed, content: koreanText }), {
            headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
          });
        }
      } catch {
        console.log("[WorkPlan AI] JSON parse failed, returning as text");
      }

      return new Response(JSON.stringify({ content }), {
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });
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

    // v4: rich HSE prompt + multi-phase streaming
    const cacheKey = `v4|${process_name}|${equipText}|${descText}|${locationText}|${envText}|${detailLevel}`
      .toLowerCase()
      .trim();

    const { data: cached } = await adminClient
      .from("ai_risk_cache")
      .select("*")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    const cachedItems = (cached?.generated_items as any[]) || [];
    const cacheMin = detailLevel === "core" ? 15 : 20;

    const emitCachedOrGenerate = async (
      send: (payload: Record<string, unknown>) => void,
    ) => {
      if (cached && Array.isArray(cachedItems) && cachedItems.length >= cacheMin) {
        console.log(`[AI Engine] Cache hit (stream): ${cachedItems.length}`);
        await adminClient
          .from("ai_risk_cache")
          .update({ hit_count: (cached.hit_count || 0) + 1 })
          .eq("id", cached.id);

        send({
          type: "meta",
          source: "cache",
          normalized_equipment: normalizedEquipment,
          detail_level: detailLevel,
        });
        for (const item of cachedItems) {
          send({ type: "item", item });
        }
        send({
          type: "done",
          source: "cache",
          count: cachedItems.length,
          accident_cases: [],
          is_complete: true,
        });
        return;
      }

      const ragContext = await fetchRAGContext(adminClient, process_name, equipText, 5);
      const phases = buildPhases(detailLevel);
      const existingKeys = new Set<string>();
      const allMapped: any[] = [];
      const allAccidents: any[] = [];

      send({
        type: "meta",
        source: "ai",
        normalized_equipment: normalizedEquipment,
        detail_level: detailLevel,
        phases: phases.map((p) => p.id),
      });

      for (const phase of phases) {
        send({ type: "phase", phase: phase.id, title: phase.title });
        try {
          const { rawItems, accidents } = await streamPhaseItems(
            process_name,
            equipText,
            descText,
            locationText,
            envText,
            ragContext,
            phase,
            (raw) => {
              const mapped = mapAndDedupe([raw], process_name, existingKeys);
              for (const item of mapped) {
                allMapped.push(item);
                send({ type: "item", item, phase: phase.id });
              }
            },
          );
          // Ensure any items not emitted mid-stream are still mapped
          const leftover = mapAndDedupe(rawItems, process_name, existingKeys);
          for (const item of leftover) {
            allMapped.push(item);
            send({ type: "item", item, phase: phase.id });
          }
          for (const a of accidents) {
            allAccidents.push(a);
            send({ type: "accident", accident: a });
          }
        } catch (phaseErr) {
          console.error(`[AI Engine] phase ${phase.id} error:`, phaseErr);
          if (phaseErr instanceof GeminiError) {
            if (phaseErr.code === "RATE_LIMIT") throw new Error("RATE_LIMIT");
            if (phaseErr.code === "QUOTA_EXHAUSTED") throw new Error("CREDITS_EXHAUSTED");
            if (phaseErr.code === "INVALID_KEY") throw new Error("INVALID_KEY");
          }
          // Continue other phases if one fails mid-way — partial results still useful
          send({
            type: "phase_error",
            phase: phase.id,
            error: phaseErr instanceof Error ? phaseErr.message : String(phaseErr),
          });
        }
      }

      if (allMapped.length === 0) {
        send({
          type: "error",
          error: "AI가 유효한 위험성평가 항목을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.",
        });
        return;
      }

      const { error: cacheErr } = await adminClient.from("ai_risk_cache").upsert(
        {
          cache_key: cacheKey,
          process_name,
          equipment: equipText,
          work_description: descText,
          work_location: locationText,
          work_environment: work_environment || [],
          generated_items: allMapped,
          hit_count: 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "cache_key" },
      );
      if (cacheErr) console.warn("[AI Engine] cache upsert skipped:", cacheErr.message);

      send({
        type: "done",
        source: "ai",
        count: allMapped.length,
        accident_cases: allAccidents.slice(0, 3),
        is_complete: true,
        normalized_equipment: normalizedEquipment,
        detail_level: detailLevel,
      });
    };

    if (wantStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (payload: Record<string, unknown>) => {
            controller.enqueue(sseEncode(encoder, payload));
          };
          try {
            // heartbeat so proxies keep the connection
            controller.enqueue(encoder.encode(`: connected\n\n`));
            await emitCachedOrGenerate(send);
          } catch (e) {
            console.error("generate-risk-ai stream error:", e);
            const msg = e instanceof Error ? e.message : "Unknown error";
            let error = msg;
            if (msg === "RATE_LIMIT") error = "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
            else if (msg === "CREDITS_EXHAUSTED") {
              error = "AI 크레딧이 부족합니다. 워크스페이스 크레딧을 충전해주세요.";
            } else if (msg === "INVALID_KEY") {
              error = "AI API 키가 유효하지 않습니다. 마스터가 설정 > 시크릿에서 확인해야 합니다.";
            }
            try {
              send({ type: "error", error });
            } catch { /* controller may be closed */ }
          } finally {
            try {
              controller.close();
            } catch { /* ignore */ }
          }
        },
      });

      return new Response(stream, { headers: sseHeaders });
    }

    // Non-stream JSON fallback (orchestrator / legacy)
    const collectedItems: any[] = [];
    const collectedAccidents: any[] = [];
    let source = "ai";
    await emitCachedOrGenerate((payload) => {
      if (payload.type === "item" && payload.item) collectedItems.push(payload.item);
      if (payload.type === "accident" && payload.accident) collectedAccidents.push(payload.accident);
      if (payload.type === "done") source = String(payload.source || "ai");
      if (payload.type === "error") throw new Error(String(payload.error));
    });

    return new Response(
      JSON.stringify({
        items: collectedItems,
        accident_cases: collectedAccidents.slice(0, 3),
        source,
        count: collectedItems.length,
        normalized_equipment: normalizedEquipment,
        detail_level: detailLevel,
        is_complete: true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (e) {
    console.error("generate-risk-ai error:", e);
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg === "RATE_LIMIT") {
      return new Response(JSON.stringify({ error: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요." }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });
    }
    if (msg === "CREDITS_EXHAUSTED") {
      return new Response(
        JSON.stringify({ error: "AI 크레딧이 부족합니다. 워크스페이스 크레딧을 충전해주세요." }),
        { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } },
      );
    }
    if (msg === "INVALID_KEY") {
      return new Response(
        JSON.stringify({ error: "AI API 키가 유효하지 않습니다. 마스터가 설정 > 시크릿에서 확인해야 합니다." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } },
      );
    }
    return new Response(
      JSON.stringify({
        error: msg.startsWith("AI_ERROR_")
          ? "AI 서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
          : msg,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } },
    );
  }
});
