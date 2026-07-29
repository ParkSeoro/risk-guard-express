import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChatFetch, streamGeminiChatText, GeminiError } from "../_shared/gemini.ts";
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

const HSE_SYSTEM_PROMPT = `/no_think
너는 20년 경력의 대한민국 건설현장 최고 안전보건전문가(HSE)다.
목적: 위험성평가 테이블(행) 데이터만 순수 생성. 사고사례·설명문·프롬프트/스키마 지시어 누수 절대 금지.

[CRITICAL WARNING — Anti-Macro]
절대로 '[OOO] 단계에서 관리·장비·환경 요인이 겹치며 [OOO]로 이어질 수 있음'과 같은 기계적 템플릿(매크로) 문장을 반복 사용하지 마라.
각 위험발생상황은 해당 세부작업의 실제 물리적·환경적 특성(높이, 하중, 전원, 가스, 동선, 지반, 기상 등)을 반영해 **완전히 다른 문장 구조**로 개별 창작하라.
'기본 점검 준수', '작업전 TBM', '표준작업절차(SOP)에 따른 일상점검'처럼 모든 행에 복붙되는 무의미한 기존대책도 금지.

[절대 규칙]
1. 해당 공종의 잠재 위험 요인을 가혹할 정도로 최대한(Exhaustive) 도출.
2. 문체: 서술형(~할 것, ~합니다, ~해야 한다, ~서술할 것, ~작성할 것) 절대 금지. 개조식(명사형)만 허용. 종결 예: '~음', '~함', '~발생 우려', '~미흡', '~조치'.
3. 위험발생상황·기존대책·개선대책은 짧고 굵게. 빈칸(null,'-','없음','') 금지. 스키마 description·프롬프트 문장을 값으로 복사하지 말 것.
4. 치명 위험(추락·협착·감전·질식·붕괴·화재·폭발·중장비 충돌 등)은 위험도·심각도 '상'. 무조건 '하' 금지.
5. 기존대책: 현장에서 실제로 취하는 구체적 물리적/관리적 조치로 작성. 예: "안전조끼 착용, 반경 5m 접근 통제선 설치", "절연장갑·절연장화 착용, 활선접근경보기 휴대".
6. 개선대책: 본질안전(제거·대체)→공학적(방호·격리·환기)→관리적(작업허가·교육·표지)→PPE 순. PPE만 나열 금지.
7. 포맷: 쉼표(,) 뒤에는 반드시 공백 1칸. 한자(漢字)·한중 혼용(예: 미실施) 금지. 100% 자연스러운 한국어 표준어만.
8. 법적근거는 산안법·산안기준규칙 조항 또는 KOSHA GUIDE 코드만.
9. 출력은 오직 JSON. 코드펜스·설명문·사고사례 필드 금지.`;

/** Noun-only field definitions — never put imperative instructions here (prevents prompt leak into values). */
const RISK_ITEM_FIELD_SCHEMA: Record<string, string> = {
  공정: "공종명",
  세부작업: "세부 작업 명칭",
  위험요인: "발생 가능한 유해·위험 요인",
  발생상황: "발생 가능한 위험 상황",
  기존대책: "현재 현장의 구체적 안전 조치",
  개선대책: "추가 감소 대책",
  위험도: "가능성 등급(상|중|하)",
  심각도: "중대성 등급(상|중|하)",
  개선후위험도: "개선 후 가능성 등급",
  개선후심각도: "개선 후 중대성 등급",
  보호구: "필요 보호구 목록",
  법적근거: "관련 법령·가이드 코드",
};

const LEAK_INSTRUCTION_RE =
  /(서술할\s*것|작성할\s*것|기재할\s*것|포함할\s*것|도출할\s*것|준수할\s*것|특정해\s*서술|개조식으로\s*작성|빈칸\s*금지)/g;
const MACRO_SITUATION_RE =
  /단계에서\s*관리[·・,]?\s*장비[·・,]?\s*환경\s*요인이\s*겹치며/;
const VAGUE_MEASURE_RE =
  /^(기본\s*점검\s*준수|일상\s*점검|표준작업절차\(SOP\)에\s*따른\s*일상점검.*|작업전\s*TBM\s*및\s*위험성\s*고지.*)$/;

function normalizeCommaSpacing(text: string): string {
  return text
    .replace(/,(?!\s)/g, ", ")
    .replace(/，/g, ", ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Strip schema/prompt instruction leaks and reject macro templates. */
function sanitizeFieldText(raw: string, kind: "situation" | "measure" | "other"): string | null {
  let s = String(raw ?? "").trim();
  if (!s || s === "-" || s === "없음" || s.toLowerCase() === "null") return null;

  s = s.replace(LEAK_INSTRUCTION_RE, "").trim();
  s = s.replace(/[.。]+\s*$/, "").trim();
  s = normalizeCommaSpacing(s);

  // Drop leftover imperative endings that leaked from prompts
  if (/(할\s*것|합니다|해야\s*한다)\s*$/.test(s)) {
    s = s.replace(/(할\s*것|합니다|해야\s*한다)\s*$/g, "").trim();
  }

  if (!s) return null;
  if (kind === "situation" && MACRO_SITUATION_RE.test(s)) return null;
  if (kind === "measure" && VAGUE_MEASURE_RE.test(s)) return null;

  // Reject if still looks like a schema placeholder / instruction echo
  if (/^(원인\+결과|짧은\s*개조식|현장\s*통상\s*조치|본질안전→|개조식)/.test(s)) return null;

  return s;
}

type PhaseDef = {
  id: string;
  title: string;
  focus: string;
  targetCount: number;
};

function buildPhases(detailLevel: "core" | "comprehensive"): PhaseDef[] {
  // Client orchestrates one phase per HTTP request so each stays under ~150s.
  // Accidents are intentionally excluded — use generate-accident-ai.
  if (detailLevel === "core") {
    return [
      {
        id: "prep_main",
        title: "준비·본작업",
        focus: "작업허가·장비점검·본작업 중 추락·협착·붕괴·감전·충돌·유해물질 등 4M 치명 위험",
        targetCount: 10,
      },
      {
        id: "finish",
        title: "마무리·비상",
        focus: "철수·정리·잔여위험·비상조치·복구",
        targetCount: 6,
      },
    ];
  }
  return [
    {
      id: "prep",
      title: "작업 전 준비·반입",
      focus: "사전조사·작업허가·장비반입·양중·지장물·환기측정·보호구·신호수·구역통제",
      targetCount: 9,
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

function mapRawItem(item: any, processName: string): any | null {
  const sub_task = sanitizeFieldText(
    String(item["세부작업"] || item.sub_task || ""),
    "other",
  );
  const hazard = sanitizeFieldText(
    String(item["위험요인"] || item.hazard || ""),
    "other",
  );
  if (!sub_task || !hazard) return null;

  // Never soft-fill with instructional macros — incomplete rows are dropped.
  const hazard_situation = sanitizeFieldText(
    String(item["발생상황"] || item.hazard_situation || ""),
    "situation",
  );
  const existing_measure = sanitizeFieldText(
    String(item["기존대책"] || item.existing_measure || ""),
    "measure",
  );
  const improvement_measure = sanitizeFieldText(
    String(item["개선대책"] || item.improvement_measure || ""),
    "measure",
  );
  if (!hazard_situation || !existing_measure || !improvement_measure) return null;

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
  const ppe = Array.isArray(ppeRaw)
    ? ppeRaw.map(String).map((s) => s.trim()).filter(Boolean)
    : String(ppeRaw).split(/[,，]/).map((s) => s.trim()).filter(Boolean);
  const legalRaw = item["법적근거"] ?? item.legal_basis ?? "";
  const legal_basis = Array.isArray(legalRaw)
    ? legalRaw.map(String).filter(Boolean)
    : String(legalRaw).trim()
    ? [String(legalRaw).trim()]
    : [];

  return {
    process: sanitizeFieldText(String(item["공정"] || item.process || processName), "other") || processName,
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
): Promise<{ rawItems: any[] }> {
  const fieldSchemaLines = Object.entries(RISK_ITEM_FIELD_SCHEMA)
    .map(([k, v]) => `- ${k}: ${v}`)
    .join("\n");

  const userPrompt = `[입력]
공종: ${processName}
장비: ${equipText}
작업내용: ${descText}
작업위치: ${locationText}
작업조건/환경: ${envText}
${ragContext}

[이번 배치 — ${phase.title}]
초점: ${phase.focus}
items를 최소 ${phase.targetCount}개 이상, 가능하면 ${phase.targetCount + 2}개까지 Exhaustive 도출.
각 행의 발생상황·기존대책·개선대책은 서로 다른 구체 내용(매크로 복붙 금지).
치명 재해(추락·협착·감전·질식·붕괴 등)는 위험도/심각도 '상'.
사고사례·accident_cases·설명문·스키마 지시문 출력 금지.

[필드 정의 — 명사형만. 이 문구를 값으로 복사하지 말 것]
${fieldSchemaLines}

[출력 JSON 예시 — 값은 예시일 뿐, 그대로 복제 금지]
{"items":[{"공정":"${processName}","세부작업":"용접부 가우징","위험요인":"용접흄·아크광 흡입 및 안면 화상","발생상황":"밀폐 배관 내부 가우징 시 환기 부족으로 흄 체류, 아크 반사광에 안면 노출 우려","기존대책":"송기마스크 착용, 국소배기 가동, 차광면 착용","개선대책":"강제환기 덕트 설치, 연속 작업 시 교대 휴식, 용접면 자동차광 렌즈 사용","위험도":"상","심각도":"상","개선후위험도":"하","개선후심각도":"중","보호구":["송기마스크","차광면","가죽앞치마"],"법적근거":"산안기준규칙 제429조"}]}`;

  let buffer = "";
  let emitted = 0;
  const collected: any[] = [];

  for await (const chunk of streamGeminiChatText({
    messages: [
      { role: "system", content: HSE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.55,
    max_tokens: 4000,
    response_format: { type: "json_object" },
    compact: true,
  })) {
    buffer += chunk;
    const { objects, nextIndex } = extractCompletedObjects(buffer, emitted);
    for (const obj of objects) {
      collected.push(obj);
      onDeltaItem(obj);
    }
    emitted = nextIndex;
  }

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

  return { rawItems: collected.length ? collected : (finalParsed?.items || []) };
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
      phase_id: phaseIdBody,
    } = body;

    const detailLevel: "core" | "comprehensive" =
      detail_level === "core" ? "core" : "comprehensive";
    const wantStream = streamFlag !== false; // default ON for risk mode
    const allPhases = buildPhases(detailLevel);
    const selectedPhases = phaseIdBody
      ? allPhases.filter((p) => p.id === phaseIdBody)
      : allPhases;
    if (phaseIdBody && selectedPhases.length === 0) {
      return new Response(JSON.stringify({ error: `Unknown phase_id: ${phaseIdBody}` }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
      });
    }

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

    // v5: anti-macro + noun-only field schema (no instructional soft-fill)
    const cacheKey = `v5|${process_name}|${equipText}|${descText}|${locationText}|${envText}|${detailLevel}`
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
      // Full-result cache only when generating all phases in one request
      if (
        !phaseIdBody &&
        cached &&
        Array.isArray(cachedItems) &&
        cachedItems.length >= cacheMin
      ) {
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
          is_complete: true,
          mode: "risk",
        });
        return;
      }

      // Approved standard_risk_library hit — avoid LLM when corpus is rich enough
      if (!phaseIdBody) {
        const libraryItems = await fetchApprovedLibraryRisks(adminClient, process_name, cacheMin + 8);
        if (libraryItems.length >= Math.min(12, cacheMin)) {
          console.log(`[AI Engine] Library hit (stream): ${libraryItems.length}`);
          send({
            type: "meta",
            source: "library",
            normalized_equipment: normalizedEquipment,
            detail_level: detailLevel,
            mode: "risk",
          });
          for (const item of libraryItems) send({ type: "item", item });
          send({
            type: "done",
            source: "library",
            count: libraryItems.length,
            is_complete: true,
            mode: "risk",
          });
          await adminClient.from("ai_risk_cache").upsert(
            {
              cache_key: cacheKey,
              generated_items: libraryItems,
              process_name,
              hit_count: 1,
              project_id: project_id || null,
            },
            { onConflict: "cache_key" },
          );
          return;
        }
      }

      const ragContext = await fetchRAGContext(adminClient, process_name, equipText, 5);
      const phases = selectedPhases;
      const existingKeys = new Set<string>();
      const allMapped: any[] = [];

      send({
        type: "meta",
        source: "ai",
        normalized_equipment: normalizedEquipment,
        detail_level: detailLevel,
        phases: phases.map((p) => p.id),
        phase_mode: phaseIdBody ? "single" : "all",
        mode: "risk",
      });

      for (const phase of phases) {
        send({ type: "phase", phase: phase.id, title: phase.title });
        try {
          const { rawItems } = await streamPhaseItems(
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
          const leftover = mapAndDedupe(rawItems, process_name, existingKeys);
          for (const item of leftover) {
            allMapped.push(item);
            send({ type: "item", item, phase: phase.id });
          }
        } catch (phaseErr) {
          console.error(`[AI Engine] phase ${phase.id} error:`, phaseErr);
          if (phaseErr instanceof GeminiError) {
            if (phaseErr.code === "RATE_LIMIT") throw new Error("RATE_LIMIT");
            if (phaseErr.code === "QUOTA_EXHAUSTED") throw new Error("CREDITS_EXHAUSTED");
            if (phaseErr.code === "INVALID_KEY") throw new Error("INVALID_KEY");
          }
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

      if (!phaseIdBody) {
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
      }

      send({
        type: "done",
        source: "ai",
        count: allMapped.length,
        is_complete: true,
        normalized_equipment: normalizedEquipment,
        detail_level: detailLevel,
        phase_id: phaseIdBody || null,
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
