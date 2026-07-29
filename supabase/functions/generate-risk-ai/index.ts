import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChatFetch } from "../_shared/gemini.ts";
import {
  streamDeepseekRiskChatText,
  DeepseekRiskError,
  RISK_DEEPSEEK_SYSTEM_PROMPT,
  safeParseDeepseekRiskItems,
} from "../_shared/deepseekRisk.ts";

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

const HSE_SYSTEM_PROMPT = RISK_DEEPSEEK_SYSTEM_PROMPT;

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

/** Soft guidance count for user prompt (keep modest for latency). */
function jsaGuideCount(detailLevel: "core" | "comprehensive"): number {
  return detailLevel === "core" ? 8 : 12;
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

function tryParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Parse one JSONL line into an object (tolerates trailing commas / fence crumbs). */
function parseJsonlLine(raw: string): any | null {
  let s = String(raw || "").trim();
  if (!s) return null;
  if (s.startsWith("```")) return null;
  if (s === "[" || s === "]" || s === "," || s === "],") return null;
  s = s.replace(/^```json/i, "").replace(/```$/g, "").trim();
  s = s.replace(/,\s*$/, "");
  if (!(s.startsWith("{") && s.endsWith("}"))) return null;
  const parsed = tryParse(s);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed;
}

/**
 * Drain complete JSONL lines from a growing text buffer.
 * Incomplete last line stays in `rest`.
 */
function drainJsonlObjects(buffer: string): { objects: any[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n");
  const rest = parts.pop() ?? "";
  const objects: any[] = [];
  for (const line of parts) {
    const obj = parseJsonlLine(line);
    if (obj) objects.push(obj);
  }
  return { objects, rest };
}

function sseEncode(encoder: TextEncoder, payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function buildJsaUserPrompt(
  processName: string,
  equipText: string,
  descText: string,
  locationText: string,
  envText: string,
  detailLevel: "core" | "comprehensive",
): string {
  const guideCount = jsaGuideCount(detailLevel);
  return `[입력] 공종:${processName} / 장비:${equipText} / 작업:${descText} / 위치:${locationText} / 환경:${envText}

위 입력에 대해 JSA 방식(작업 전 준비 ➔ 본 작업 ➔ 마무리)으로 누락 없이 위험성평가를 작성하라.
대략 ${guideCount}개 내외. 추상문구 금지. 공학적·관리적·PPE 포함.
마크다운·서론·결론 금지.
절대 JSON Array([ ])로 묶지 마라. 객체 사이 쉼표 금지.
한 줄에 JSON 객체 하나만 — JSON Lines(JSONL)로만 출력.`;
}

/**
 * One-Shot DeepSeek stream → emit each completed JSONL object as its line completes.
 * No prep/main/finish phases.
 */
async function streamOneShotRiskItems(
  processName: string,
  equipText: string,
  descText: string,
  locationText: string,
  envText: string,
  detailLevel: "core" | "comprehensive",
  onItem: (mapped: any) => void,
): Promise<{ count: number }> {
  const userPrompt = buildJsaUserPrompt(
    processName,
    equipText,
    descText,
    locationText,
    envText,
    detailLevel,
  );
  // Keep tokens moderate so Edge stays under wall-clock budget while streaming.
  const maxTokens = detailLevel === "comprehensive" ? 5500 : 4000;
  const existingKeys = new Set<string>();
  let buffer = "";
  let count = 0;

  const emitRaw = (rawObjects: any[]) => {
    const mapped = mapAndDedupe(rawObjects, processName, existingKeys);
    for (const item of mapped) {
      count++;
      onItem(item);
    }
  };

  for await (const delta of streamDeepseekRiskChatText({
    messages: [
      { role: "system", content: HSE_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.25,
    max_tokens: maxTokens,
    timeoutMs: 120_000,
  })) {
    buffer += delta;
    const { objects, rest } = drainJsonlObjects(buffer);
    buffer = rest;
    if (objects.length) emitRaw(objects);
  }

  // Final incomplete line / leftover
  const last = parseJsonlLine(buffer);
  if (last) emitRaw([last]);
  else {
    // Fallback: model ignored JSONL and returned an array — salvage what we can
    const salvaged = safeParseDeepseekRiskItems(buffer);
    if (salvaged.length) emitRaw(salvaged);
  }

  return { count };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

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
    } = body;

    const detailLevel: "core" | "comprehensive" =
      detail_level === "comprehensive" ? "comprehensive" : "core";

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

    // ============ Risk Assessment Mode: One-Shot JSA + SSE (no prep/main/finish) ============
    // Stream DeepSeek deltas; emit each completed item over SSE to avoid 150s idle/non-stream timeout.
    const normalizedEquipment = normalizeEquipment(equipment || "");
    const locationText = work_location || "일반";
    const envText =
      work_environment && work_environment.length > 0
        ? work_environment.join(", ")
        : "일반 작업 환경";
    const equipText = normalizedEquipment || "없음";
    const descText = work_description || process_name + " 관련 작업";

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (payload: Record<string, unknown>) => {
          try {
            controller.enqueue(sseEncode(encoder, payload));
          } catch {
            /* closed */
          }
        };
        const heartbeat = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
          } catch {
            /* closed */
          }
        }, 4000);

        try {
          controller.enqueue(encoder.encode(`: connected\n\n`));
          send({
            type: "meta",
            source: "ai",
            normalized_equipment: normalizedEquipment,
            detail_level: detailLevel,
            mode: "risk",
            oneshot: true,
            jsa: true,
          });
          send({ type: "status", message: "DeepSeek JSA 스트리밍 생성 시작…" });

          let emitted = 0;
          const { count } = await streamOneShotRiskItems(
            process_name,
            equipText,
            descText,
            locationText,
            envText,
            detailLevel,
            (item) => {
              emitted++;
              send({ type: "item", item, index: emitted });
              send({
                type: "status",
                message: `${emitted}건 생성됨…`,
                items_so_far: emitted,
              });
            },
          );

          if (count === 0) {
            send({
              type: "error",
              error: "AI가 유효한 위험성평가 항목을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.",
            });
            return;
          }

          send({
            type: "done",
            source: "ai",
            count,
            is_complete: true,
            normalized_equipment: normalizedEquipment,
            detail_level: detailLevel,
            mode: "risk",
          });
        } catch (e) {
          console.error("generate-risk-ai stream error:", e);
          const msg = e instanceof Error ? e.message : "Unknown error";
          let error = msg;
          if (msg === "RATE_LIMIT" || (e instanceof DeepseekRiskError && e.code === "RATE_LIMIT")) {
            error = "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.";
          } else if (
            msg === "CREDITS_EXHAUSTED" ||
            (e instanceof DeepseekRiskError && e.code === "QUOTA_EXHAUSTED")
          ) {
            error = "AI 크레딧이 부족합니다. 워크스페이스 크레딧을 충전해주세요.";
          } else if (
            msg === "INVALID_KEY" ||
            (e instanceof DeepseekRiskError && e.code === "INVALID_KEY")
          ) {
            error =
              "DeepSeek API 키가 유효하지 않습니다. DEEPSEEK_API_KEY(Supabase Edge Secrets)를 확인해야 합니다.";
          } else if (e instanceof DeepseekRiskError && e.code === "TIMEOUT") {
            error = e.message;
          }
          try {
            send({ type: "error", error });
          } catch { /* closed */ }
        } finally {
          clearInterval(heartbeat);
          try {
            controller.close();
          } catch { /* ignore */ }
        }
      },
    });

    return new Response(stream, { headers: sseHeaders });
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
