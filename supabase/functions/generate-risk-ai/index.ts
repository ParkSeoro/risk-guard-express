import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChatFetch, GeminiError } from "../_shared/gemini.ts";
import {
  callDeepseekRiskChat,
  DeepseekRiskError,
  RISK_DEEPSEEK_SYSTEM_PROMPT,
  parseDeepseekRiskJson,
  stripCodeFences,
} from "../_shared/deepseekRisk.ts";
import { fetchApprovedLibraryRisks } from "../_shared/aiResponseCache.ts";

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

const HSE_SYSTEM_PROMPT = RISK_DEEPSEEK_SYSTEM_PROMPT;

/** Noun-only field definitions — never put imperative instructions here (prevents prompt leak into values). */
const RISK_ITEM_FIELD_SCHEMA: Record<string, string> = {
  process: "공종명",
  sub_work: "세부 작업 명칭(장비·부재·절차 포함)",
  hazard_factor: "법적 기준/원인 + 위험 메커니즘",
  hazard_situation: "구체적 위험 발생 시나리오(개조식)",
  existing_control: "현재 현장의 구체적 안전 조치",
  improvement_control: "공학적 + 관리적 + PPE 대책",
  initial_likelihood: "가능성 등급(상|중|하)",
  initial_severity: "중대성 등급(상|중|하)",
  initial_risk_level: "초기 위험등급(상|중|하)",
  residual_likelihood: "개선 후 가능성",
  residual_severity: "개선 후 중대성",
  residual_risk_level: "잔여 위험등급",
  ppe: "필요 보호구",
};

const LEAK_INSTRUCTION_RE =
  /(서술할\s*것|작성할\s*것|기재할\s*것|포함할\s*것|도출할\s*것|준수할\s*것|특정해\s*서술|개조식으로\s*작성|빈칸\s*금지)/g;
const MACRO_SITUATION_RE =
  /단계에서\s*관리[·・,]?\s*장비[·・,]?\s*환경\s*요인이\s*겹치며/;
const VAGUE_MEASURE_RE =
  /^(기본\s*점검\s*준수|일상\s*점검|표준작업절차\(SOP\)에\s*따른\s*일상점검.*|작업전\s*TBM\s*및\s*위험성\s*고지.*|안전수칙\s*준수|주의\s*작업|안전\s*주의|조심히\s*작업.*|관련\s*규정\s*준수)$/;
const VAGUE_HAZARD_RE =
  /^(안전수칙\s*미준수|부주의|주의\s*부족|일반\s*위험|작업\s*중\s*사고)$/;

function normalizeCommaSpacing(text: string): string {
  return text
    .replace(/,(?!\s)/g, ", ")
    .replace(/，/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Strip schema/prompt instruction leaks and reject macro templates. */
function sanitizeFieldText(raw: string, kind: "situation" | "measure" | "other" | "hazard"): string | null {
  let s = String(raw ?? "").trim();
  if (!s || s === "-" || s === "없음" || s.toLowerCase() === "null") return null;

  s = s.replace(LEAK_INSTRUCTION_RE, "").trim();
  s = s.replace(/[.。]+\s*$/, "").trim();
  s = normalizeCommaSpacing(s);

  if (/(할\s*것|합니다|해야\s*한다)\s*$/.test(s)) {
    s = s.replace(/(할\s*것|합니다|해야\s*한다)\s*$/g, "").trim();
  }

  if (!s) return null;
  if (kind === "situation" && MACRO_SITUATION_RE.test(s)) return null;
  if (kind === "measure" && VAGUE_MEASURE_RE.test(s)) return null;
  if (kind === "hazard" && VAGUE_HAZARD_RE.test(s)) return null;
  if (/^(원인\+결과|짧은\s*개조식|현장\s*통상\s*조치|본질안전→|개조식|공학적\s*\+|법적\s*기준\/원인)/.test(s)) return null;

  return s;
}

/** Target item count for one-shot generation (fatal KOSHA risks only). */
function oneshotTargetCount(detailLevel: "core" | "comprehensive"): number {
  return detailLevel === "core" ? 5 : 7;
}

function mapRawItem(item: any, processName: string): any | null {
  const sub_task = sanitizeFieldText(
    String(item.sub_work || item["세부작업"] || item.sub_task || ""),
    "other",
  );
  const hazard = sanitizeFieldText(
    String(item.hazard_factor || item["위험요인"] || item.hazard || ""),
    "hazard",
  );
  if (!sub_task || !hazard) return null;

  const hazard_situation = sanitizeFieldText(
    String(item.hazard_situation || item["발생상황"] || ""),
    "situation",
  );
  const existing_measure = sanitizeFieldText(
    String(item.existing_control || item["기존대책"] || item.existing_measure || ""),
    "measure",
  );
  const improvement_measure = sanitizeFieldText(
    String(item.improvement_control || item["개선대책"] || item.improvement_measure || ""),
    "measure",
  );
  if (!hazard_situation || !existing_measure || !improvement_measure) return null;

  let likelihood = String(
    item.initial_likelihood || item["위험도"] || item.likelihood_grade || item.initial_risk_level || "중",
  ).trim();
  let severity = String(
    item.initial_severity || item["심각도"] || item.severity_grade || "중",
  ).trim();
  if (!["상", "중", "하"].includes(likelihood)) likelihood = "중";
  if (!["상", "중", "하"].includes(severity)) severity = "중";

  const fatalRe = /추락|협착|끼임|감전|질식|붕괴|도괴|화재|폭발|중장비|충돌|낙하|비래/;
  if (fatalRe.test(hazard) || fatalRe.test(hazard_situation)) {
    if (likelihood === "하") likelihood = "중";
    if (severity === "하") severity = "상";
  }

  const ppeRaw = item.ppe ?? item["보호구"] ?? [];
  const ppe = Array.isArray(ppeRaw)
    ? ppeRaw.map(String).map((s) => s.trim()).filter(Boolean)
    : String(ppeRaw).split(/[,，]/).map((s) => s.trim()).filter(Boolean);

  const legalRaw = item.legal_basis ?? item["법적근거"] ?? "";
  const legal_basis = Array.isArray(legalRaw)
    ? legalRaw.map(String).filter(Boolean)
    : String(legalRaw).trim()
    ? [String(legalRaw).trim()]
    : [];

  const improvedLikelihood = String(
    item.residual_likelihood || item["개선후위험도"] || item.improved_likelihood_grade || item.residual_risk_level || "",
  ).trim();
  const improvedSeverity = String(
    item.residual_severity || item["개선후심각도"] || item.improved_severity_grade || "",
  ).trim();

  return {
    process: sanitizeFieldText(String(item.process || item["공정"] || processName), "other") || processName,
    sub_task,
    hazard,
    hazard_situation,
    existing_measure,
    improvement_measure,
    likelihood_grade: likelihood,
    severity_grade: severity,
    improved_likelihood_grade: ["상", "중", "하"].includes(improvedLikelihood) ? improvedLikelihood : "하",
    improved_severity_grade: ["상", "중", "하"].includes(improvedSeverity) ? improvedSeverity : "하",
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

function sseEncode(encoder: TextEncoder, payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

/** Single DeepSeek call → 5–7 fatal KOSHA risks (no prep/main/finish phases). */
async function generateOneShotRiskItems(
  processName: string,
  equipText: string,
  descText: string,
  locationText: string,
  envText: string,
  ragContext: string,
  detailLevel: "core" | "comprehensive",
): Promise<any[]> {
  const targetCount = oneshotTargetCount(detailLevel);
  const fieldSchemaLines = Object.entries(RISK_ITEM_FIELD_SCHEMA)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const userPrompt = `[입력] 공종:${processName} / 장비:${equipText} / 작업:${descText} / 위치:${locationText} / 환경:${envText}
${ragContext}

산업안전보건기준에 관한 규칙 및 KOSHA GUIDE에 의거하여, 해당 공종에서 [사망, 중상, 화재, 폭발]로 직결되는 가장 치명적인 핵심 위험요인 ${targetCount}개만 엄선하여 작성하라.
망라·과다 생성 금지. 추상문구 금지. improvement_control에 공학적·관리적·PPE 모두.
치명재해는 initial_* '상'. 마크다운 금지. JSON만.

[필드]
${fieldSchemaLines}

[형식] {"items":[{"process":"${processName}","sub_work":"...","hazard_factor":"...","hazard_situation":"...","existing_control":"...","improvement_control":"...","initial_likelihood":"상","initial_severity":"상","initial_risk_level":"상","residual_likelihood":"중","residual_severity":"중","residual_risk_level":"중","ppe":"안전모, 안전화"}]}`;

  const maxTokens = Math.min(2800, 400 + targetCount * 320);
  const { content } = await callDeepseekRiskChat({
    messages: [
      { role: "system", content: HSE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: maxTokens,
    timeoutMs: 55_000,
  });

  let parsed: any = null;
  try {
    parsed = parseDeepseekRiskJson(stripCodeFences(content));
  } catch {
    const m = content.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (m) {
      try {
        parsed = parseDeepseekRiskJson(m[0]);
      } catch {
        parsed = null;
      }
    }
  }

  const items: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.items)
    ? parsed.items
    : [];

  return items.slice(0, Math.max(targetCount, 7));
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
      detail_level === "comprehensive" ? "comprehensive" : "core";
    // One-shot JSON is the stable default; SSE only when client explicitly opts in.
    const wantStream = streamFlag === true;
    const targetCount = oneshotTargetCount(detailLevel);

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

    // ============ Risk Assessment Mode (one-shot DeepSeek, non-stream by default) ============
    const normalizedEquipment = normalizeEquipment(equipment || "");
    const locationText = work_location || "일반";
    const envText =
      work_environment && work_environment.length > 0
        ? work_environment.join(", ")
        : "일반 작업 환경";
    const equipText = normalizedEquipment || "없음";
    const descText = work_description || process_name + " 관련 작업";

    // v7: one-shot 5–7 fatal risks (phases removed)
    const cacheKey = `v7-os|${process_name}|${equipText}|${descText}|${locationText}|${envText}|${detailLevel}`
      .toLowerCase()
      .trim();

    const { data: cached } = await adminClient
      .from("ai_risk_cache")
      .select("*")
      .eq("cache_key", cacheKey)
      .maybeSingle();

    const cachedItems = (cached?.generated_items as any[]) || [];
    const cacheMin = 5;

    const emitCachedOrGenerate = async (
      send: (payload: Record<string, unknown>) => void,
    ) => {
      if (cached && Array.isArray(cachedItems) && cachedItems.length >= cacheMin) {
        console.log(`[AI Engine] Cache hit (oneshot): ${cachedItems.length}`);
        await adminClient
          .from("ai_risk_cache")
          .update({ hit_count: (cached.hit_count || 0) + 1 })
          .eq("id", cached.id);

        send({
          type: "meta",
          source: "cache",
          normalized_equipment: normalizedEquipment,
          detail_level: detailLevel,
          mode: "risk",
        });
        for (const item of cachedItems) {
          send({ type: "item", item });
        }
        send({
          type: "done",
          source: "cache",
          count: cachedItems.length,
          is_complete: true,
          mode: "risk",
        });
        return;
      }

      const libraryItems = await fetchApprovedLibraryRisks(adminClient, process_name, targetCount + 4);
      if (libraryItems.length >= cacheMin) {
        console.log(`[AI Engine] Library hit (oneshot): ${libraryItems.length}`);
        const trimmed = libraryItems.slice(0, Math.max(targetCount, 7));
        send({
          type: "meta",
          source: "library",
          normalized_equipment: normalizedEquipment,
          detail_level: detailLevel,
          mode: "risk",
        });
        for (const item of trimmed) send({ type: "item", item });
        send({
          type: "done",
          source: "library",
          count: trimmed.length,
          is_complete: true,
          mode: "risk",
        });
        await adminClient.from("ai_risk_cache").upsert(
          {
            cache_key: cacheKey,
            generated_items: trimmed,
            process_name,
            hit_count: 1,
            project_id: project_id || null,
          },
          { onConflict: "cache_key" },
        );
        return;
      }

      const ragContext = await fetchRAGContext(adminClient, process_name, equipText, 3);
      const existingKeys = new Set<string>();

      send({
        type: "meta",
        source: "ai",
        normalized_equipment: normalizedEquipment,
        detail_level: detailLevel,
        mode: "risk",
        oneshot: true,
        target_count: targetCount,
      });

      let rawItems: any[] = [];
      try {
        rawItems = await generateOneShotRiskItems(
          process_name,
          equipText,
          descText,
          locationText,
          envText,
          ragContext,
          detailLevel,
        );
      } catch (genErr) {
        console.error(`[AI Engine] oneshot error:`, genErr);
        if (genErr instanceof DeepseekRiskError || genErr instanceof GeminiError) {
          if (genErr.code === "RATE_LIMIT") throw new Error("RATE_LIMIT");
          if (genErr.code === "QUOTA_EXHAUSTED") throw new Error("CREDITS_EXHAUSTED");
          if (genErr.code === "INVALID_KEY") throw new Error("INVALID_KEY");
          if (genErr instanceof DeepseekRiskError && genErr.code === "TIMEOUT") {
            throw new Error(genErr.message);
          }
        }
        throw genErr;
      }

      const allMapped = mapAndDedupe(rawItems, process_name, existingKeys);
      for (const item of allMapped) {
        send({ type: "item", item });
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
        is_complete: true,
        normalized_equipment: normalizedEquipment,
        detail_level: detailLevel,
        mode: "risk",
      });
    };

    if (wantStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (payload: Record<string, unknown>) => {
            controller.enqueue(sseEncode(encoder, payload));
          };
          // Heartbeat while one-shot DeepSeek awaits (idle proxy/browser cutoffs).
          const heartbeat = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
            } catch {
              /* closed */
            }
          }, 4000);
          try {
            controller.enqueue(encoder.encode(`: connected\n\n`));
            send({ type: "status", message: "생성 시작" });
            await emitCachedOrGenerate(send);
          } catch (e) {
            console.error("generate-risk-ai stream error:", e);
            const msg = e instanceof Error ? e.message : "Unknown error";
            let error = msg;
            if (msg === "RATE_LIMIT") error = "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
            else if (msg === "CREDITS_EXHAUSTED") {
              error = "AI 크레딧이 부족합니다. 워크스페이스 크레딧을 충전해주세요.";
            } else if (msg === "INVALID_KEY") {
              error = "DeepSeek API 키가 유효하지 않습니다. DEEPSEEK_API_KEY(Supabase Edge Secrets)를 확인해야 합니다.";
            }
            try {
              send({ type: "error", error });
            } catch { /* controller may be closed */ }
          } finally {
            clearInterval(heartbeat);
            try {
              controller.close();
            } catch { /* ignore */ }
          }
        },
      });

      return new Response(stream, { headers: sseHeaders });
    }

    // Default: non-stream JSON (stable under idle timeouts)
    const collectedItems: any[] = [];
    let source = "ai";
    await emitCachedOrGenerate((payload) => {
      if (payload.type === "item" && payload.item) collectedItems.push(payload.item);
      if (payload.type === "done") source = String(payload.source || "ai");
      if (payload.type === "error") throw new Error(String(payload.error));
    });

    return new Response(
      JSON.stringify({
        items: collectedItems,
        source,
        count: collectedItems.length,
        normalized_equipment: normalizedEquipment,
        detail_level: detailLevel,
        is_complete: true,
        mode: "risk",
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
        JSON.stringify({ error: "DeepSeek API 키가 유효하지 않습니다. DEEPSEEK_API_KEY(Supabase Edge Secrets)를 확인해야 합니다." }),
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
