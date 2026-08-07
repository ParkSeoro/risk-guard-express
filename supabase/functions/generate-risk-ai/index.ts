import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { geminiChatFetch } from "../_shared/gemini.ts";
import {
  streamDeepseekRiskChatText,
  callDeepseekRiskChat,
  parseDeepseekRiskJson,
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
/** Downtime / productivity issues are NOT safety hazards (JSA). */
const DOWNTIME_HAZARD_RE =
  /(작업\s*중단|공정\s*지연|공기\s*지연|생산성|능률\s*저하|고장\s*으로\s*인한\s*작업|고장으로\s*작업\s*중단|다운타임|downtime)/i;
/** Reject transliteration junk / unknown coinages (e.g. 미스어린 ← misaligned). */
const GIBBERISH_HAZARD_RE =
  /(미스어린|미즈얼라인|미스얼라인|스티키니스|오퍼레이팅|해저드|리스크\s*팩터|폴링\s*오브젝트)/i;

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
  if (kind === "hazard") {
    if (VAGUE_HAZARD_RE.test(s)) return null;
    if (DOWNTIME_HAZARD_RE.test(s)) return null;
    if (GIBBERISH_HAZARD_RE.test(s)) return null;
    // Prefer hazards that name a concrete accident/injury outcome (JSA style).
    // Soft reject: pure "고장/오작동" without safety outcome → not a hazard factor.
    if (
      /(고장|오작동|불량|파손)/.test(s) &&
      !/(낙하|비래|전도|추락|협착|충돌|매몰|붕괴|감전|화재|폭발|질식|중독|절단|베임|찔림|화상|끼임|깔림|부상|재해|사망|골절|타박|압궤|타격)/.test(s)
    ) {
      return null;
    }
  }
  if (/^(원인\+결과|짧은\s*개조식|현장\s*통상\s*조치|본질안전→|개조식|공학적\s*\+|법적\s*기준\/원인)/.test(s)) return null;

  return s;
}

/** Soft ceiling only — never a target count. Processes vary widely. */
function jsaSoftCap(detailLevel: "core" | "comprehensive"): number {
  return detailLevel === "comprehensive" ? 30 : 25;
}

/** Legacy oneshot / jsa_timeline soft guidance (not used by scope_draft). */
function jsaGuideCount(detailLevel: "core" | "comprehensive"): number {
  return detailLevel === "core" ? 10 : 16;
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
  let legal_basis = Array.isArray(legalRaw)
    ? legalRaw.map(String).filter(Boolean)
    : String(legalRaw).trim()
    ? [String(legalRaw).trim()]
    : [];

  // Harvest inline citations if legal_basis array was empty
  if (legal_basis.length === 0) {
    const blob = `${hazard_situation}\n${existing_measure}\n${improvement_measure}`;
    const found = blob.match(
      /[\[(]?산업안전보건기준에\s*관한\s*규칙\s*제\s*\d+\s*조[\])]?|[\[(]?산안기준규칙\s*제\s*\d+\s*조[\])]?|[\[(]?KOSHA\s*GUIDE[^\])\n,]{0,40}[\])]?/gi,
    );
    if (found?.length) {
      legal_basis = [...new Set(found.map((s) => s.replace(/^[\[(]|[\])]$/g, "").trim()))];
    }
  }

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

/** Strip markdown fences / noise before buffering LLM text. */
function stripStreamNoise(chunk: string): string {
  return String(chunk || "")
    .replace(/```json/gi, "")
    .replace(/```/g, "");
}

/**
 * Bulletproof extractor: pull every fully-closed `{ ... }` object from a growing buffer
 * using brace depth (not naive regex — handles nested braces/strings).
 * Successfully parsed objects are removed from the returned rest buffer.
 */
function extractCompleteObjects(buffer: string): { objects: any[]; rest: string } {
  const objects: any[] = [];
  let i = 0;
  const n = buffer.length;
  let keepFrom = 0;

  while (i < n) {
    // Skip until next object start
    if (buffer[i] !== "{") {
      i++;
      continue;
    }

    let depth = 0;
    let inString = false;
    let escape = false;
    const start = i;

    for (; i < n; i++) {
      const ch = buffer[i];
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
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const raw = buffer.slice(start, i + 1);
          const parsed = tryParse(raw);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            objects.push(parsed);
            keepFrom = i + 1;
          } else {
            console.error(
              "[AI Engine] Stream parsing failed. Raw buffer slice:",
              raw.slice(0, 400),
            );
            // Skip this '{' and keep scanning — do not kill the stream
            i = start;
            keepFrom = Math.max(keepFrom, start + 1);
          }
          i++;
          break;
        }
      }
    }

    // Incomplete object — leave from `start` in rest
    if (depth !== 0) {
      return { objects, rest: buffer.slice(Math.min(keepFrom, start)) };
    }
  }

  // Drop leading junk before keepFrom; keep trailing incomplete text
  return { objects, rest: buffer.slice(keepFrom) };
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
 * One-Shot DeepSeek stream → emit each completed JSON object as braces close.
 * Bulletproof vs markdown/noise; continues after individual parse failures.
 */
async function streamOneShotRiskItems(
  processName: string,
  equipText: string,
  descText: string,
  locationText: string,
  envText: string,
  detailLevel: "core" | "comprehensive",
  onItem: (mapped: any) => void,
  onStatus?: (message: string, extra?: Record<string, unknown>) => void,
): Promise<{ count: number }> {
  const userPrompt = buildJsaUserPrompt(
    processName,
    equipText,
    descText,
    locationText,
    envText,
    detailLevel,
  );
  // Keep modest — thinking-off JSONL still needs room, but huge caps slow TTFT/finish.
  const maxTokens = detailLevel === "comprehensive" ? 4500 : 3200;
  const existingKeys = new Set<string>();
  let buffer = "";
  let count = 0;
  let lastStatusAt = 0;
  let receivedChars = 0;

  const emitRaw = (rawObjects: any[]) => {
    const mapped = mapAndDedupe(rawObjects, processName, existingKeys);
    for (const item of mapped) {
      count++;
      onItem(item);
    }
  };

  try {
    for await (const delta of streamDeepseekRiskChatText({
      messages: [
        { role: "system", content: HSE_SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.25,
      max_tokens: maxTokens,
      // Wall clock; idle is enforced inside the DeepSeek client on chunk activity.
      timeoutMs: 140_000,
    })) {
      receivedChars += delta.length;
      buffer += stripStreamNoise(delta);

      const { objects, rest } = extractCompleteObjects(buffer);
      buffer = rest;
      if (objects.length) emitRaw(objects);

      const now = Date.now();
      if (now - lastStatusAt > 2000) {
        lastStatusAt = now;
        onStatus?.(`모델 응답 수신 중… ${receivedChars}자 · ${count}건 추출`, {
          buffer_chars: buffer.length,
          received_chars: receivedChars,
          items_so_far: count,
        });
      }
    }
  } catch (e) {
    console.error(
      "[AI Engine] Stream parsing failed. Raw buffer:",
      buffer.slice(0, 800),
      e,
    );
    // Salvage whatever complete objects remain, then rethrow if nothing emitted
    const { objects } = extractCompleteObjects(buffer + "\n");
    if (objects.length) emitRaw(objects);
    if (count === 0) throw e;
  }

  // Final sweep
  const { objects: finalObjs, rest } = extractCompleteObjects(buffer);
  if (finalObjs.length) emitRaw(finalObjs);
  else {
    const salvaged = safeParseDeepseekRiskItems(rest || buffer);
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
      sub_task,
      draft_items,
      fill_stage,
    } = body;

    const detailLevel: "core" | "comprehensive" =
      detail_level === "comprehensive" ? "comprehensive" : "core";
    /** narrative | meta | all(legacy one-shot fill) */
    const fillStage: "narrative" | "meta" | "all" =
      fill_stage === "narrative" || fill_stage === "meta" || fill_stage === "all"
        ? fill_stage
        : "all";

    if (!isInternal && project_id) {
      try {
        const userSb = createClient(supabaseUrl, anonKey, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data: claimsData } = await userSb.auth.getClaims(token);
        const uid = claimsData?.claims?.sub as string | undefined;
        if (uid) {
          const [{ data: isMember }, { data: isMaster }] = await Promise.all([
            userSb.rpc("is_project_member", { _user_id: uid, _project_id: project_id }),
            userSb.rpc("is_master", { _user_id: uid }),
          ]);
          if (!isMember && !isMaster) {
            return new Response(
              JSON.stringify({ error: "이 프로젝트에 대한 권한이 없습니다." }),
              { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } },
            );
          }
        }
      } catch (authzErr) {
        // Don't block AI on flaky authz RPC — JWT was already verified above.
        console.warn("project authz check skipped:", authzErr);
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

    const normalizedEquipment = normalizeEquipment(equipment || "");
    const locationText = work_location || "일반";
    const envText =
      work_environment && work_environment.length > 0
        ? work_environment.join(", ")
        : "일반 작업 환경";
    const equipText = normalizedEquipment || "없음";
    const descText = work_description || process_name + " 관련 작업";

    // ============ Phase A: scope draft — 개수 자유, 공정 분해 완전성 ============
    if (mode === "scope_draft") {
      const softCap = jsaSoftCap(detailLevel);
      const depthHint =
        detailLevel === "comprehensive"
          ? "실제 현장 작업 단위로 빠짐없이 분해한다. 동일 작업의 위치·장비가 다르면 분리한다."
          : "준비→본작업→마무리 흐름의 실제 작업 단위로 분해한다. 불필요하게 잘게 쪼개지 않는다.";
      const sys =
        `너는 대한민국 건설현장 JSA(위험성평가) 전문가다. 반드시 JSON만 출력한다. 마크다운·서론 금지.\n` +
        `출력 스키마: {"items":[{"sub_task":"세부작업","hazard":"위험요인"}]}\n` +
        `대책·등급·PPE·법적근거·발생상황·사고사례는 절대 넣지 않는다.\n` +
        `항목 개수는 지정하지 않는다. 공종에 필요한 만큼만 쓴다.\n` +
        `hazard는 반드시 "원인 + 재해·부상 결과" 구조의 한국어 현장용어로 쓴다.\n` +
        `예: "굴착기 선회 반경 내 근로자 접근으로 인한 충돌·협착", "굴착면 붕괴로 인한 매몰".\n` +
        `금지: 작업중단·공정지연·생산성 저하를 위험요인으로 쓰기.\n` +
        `금지: 장비 고장만 언급하고 재해결과가 없는 문장.\n` +
        `금지: 영어 음역·조어·알 수 없는 단어(예: 미스어린, 미즈얼라인).\n` +
        `표준 한국어 안전용어만 사용(낙하·비래·전도·추락·협착·충돌·매몰·붕괴·감전 등).`;
      const user =
        `[입력] 공종:${process_name} / 장비:${equipText} / 작업:${descText} / 위치:${locationText} / 환경:${envText}\n\n` +
        `위 공종을 시간순(준비→본작업→마무리)으로 세부작업·핵심 위험요인(hazard)만 작성하라.\n` +
        `${depthHint}\n` +
        `각 hazard는 근로자 부상·재해로 이어지는 구체적 위험만 적을 것.\n` +
        `개수를 맞추려고 억지로 늘리거나 줄이지 말 것. 추상 문구·중복·음역어 금지.`;

      const parseDraftItems = (content: string) => {
        const parsed = parseDeepseekRiskJson<any>(content);
        let rawItems: any[] = [];
        if (Array.isArray(parsed)) rawItems = parsed;
        else if (parsed && Array.isArray(parsed.items)) rawItems = parsed.items;
        else if (parsed && Array.isArray(parsed.sub_tasks)) {
          rawItems = parsed.sub_tasks.map((s: any) =>
            typeof s === "string" ? { sub_task: s, hazard: "" } : s,
          );
        }
        const mapped = rawItems
          .map((it: any) => {
            const sub = sanitizeFieldText(
              String(it?.sub_task || it?.sub_work || "").replace(/^\d+[\.\)]\s*/, ""),
              "other",
            );
            const hazard = sanitizeFieldText(
              String(it?.hazard || it?.hazard_factor || ""),
              "hazard",
            );
            if (!sub || !hazard) return null;
            return { process: process_name, sub_task: sub, hazard };
          })
          .filter(Boolean);
        // Soft ceiling only (runaway outputs) — not a target count
        return mapped.slice(0, softCap);
      };

      try {
        // Single NVIDIA chain call (per-model timeout). Do NOT call geminiChatFetch
        // afterward — that re-hits the same Nemotron with a 90s budget and stalls UI at 0 rows.
        const deep = await callDeepseekRiskChat({
          messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
          temperature: 0.15,
          max_tokens: detailLevel === "comprehensive" ? 1800 : 1200,
          timeoutMs: 32_000,
          maxAttempts: 1,
        });
        const content = deep.content;
        if (deep.fallbackFrom) {
          console.log(`scope_draft used model=${deep.model} (from ${deep.fallbackFrom})`);
        }

        const items = parseDraftItems(content);
        if (items.length === 0) {
          return new Response(
            JSON.stringify({ error: "세부작업·위험요인 초안을 생성하지 못했습니다.", items: [] }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } },
          );
        }

        return new Response(
          JSON.stringify({
            items,
            count: items.length,
            normalized_equipment: normalizedEquipment,
            mode: "scope_draft",
            soft_cap: softCap,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } },
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        console.error("scope_draft error:", e);
        return new Response(JSON.stringify({ error: msg }), {
          status: e instanceof DeepseekRiskError ? e.status || 500 : 500,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        });
      }
    }

    // ============ Phase B batch: narrative then meta (fill_stage) ============
    if (mode === "risk_fill") {
      const drafts = Array.isArray(draft_items) ? draft_items : [];
      // Cap at 3 — larger batches often exceed Supabase gateway (~60–150s) → browser 504
      const cleaned = drafts
        .map((it: any) => ({
          sub_task: String(it?.sub_task || "").replace(/^\d+[\.\)]\s*/, "").trim(),
          hazard: String(it?.hazard || "").trim(),
          hazard_situation: String(it?.hazard_situation || "").trim(),
          existing_measure: String(it?.existing_measure || it?.existing_control || "").trim(),
          improvement_measure: String(it?.improvement_measure || it?.improvement_control || "").trim(),
        }))
        .filter((it: { sub_task: string }) => it.sub_task)
        .slice(0, 3);

      if (cleaned.length === 0) {
        return new Response(JSON.stringify({ error: "채울 초안(draft_items)이 필요합니다.", items: [] }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        });
      }

      const listText = cleaned
        .map((it: { sub_task: string; hazard: string }, i: number) =>
          `${i + 1}. 세부작업:${it.sub_task} / 위험요인:${it.hazard || "(미기재)"}`,
        )
        .join("\n");

      // fill_stage=all → single richer prompt (compat). Prefer client narrative→meta two-step.
      let sys = "";
      let user = "";
      let maxTokens = 2800;

      if (fillStage === "meta") {
        const withNarrative = cleaned
          .map((it, i) =>
            `${i + 1}. 세부작업:${it.sub_task} / 위험:${it.hazard || "(미기재)"}\n` +
            `   상황:${it.hazard_situation || "(미기재)"} / 현재대책:${it.existing_measure || "(미기재)"} / 개선:${it.improvement_measure || "(미기재)"}`,
          )
          .join("\n");
        sys =
          `너는 대한민국 건설안전 기술사다. 반드시 JSON만 출력한다. 마크다운·서론 금지.\n` +
          `출력 스키마: {"items":[{"sub_work":"세부작업","hazard_factor":"위험요인",` +
          `"initial_likelihood":"상|중|하","initial_severity":"상|중|하",` +
          `"residual_likelihood":"상|중|하","residual_severity":"상|중|하",` +
          `"ppe":["보호구"],"legal_basis":["법적근거 조항"]}]}\n` +
          `세부작업·위험·서술 필드는 바꾸지 말고, 등급·PPE·법적근거만 채운다.\n` +
          `legal_basis에는 산안기준규칙 제OOO조 또는 KOSHA GUIDE. 추상문구 금지.`;
        user =
          `[입력] 공종:${process_name} / 장비:${equipText} / 위치:${locationText}\n\n` +
          `[항목]\n${withNarrative}\n\n` +
          `위 ${cleaned.length}건의 등급·PPE·법적근거만 JSON items로 반환하라. 항목 수·순서 동일.`;
        maxTokens = Math.min(1600, 400 * cleaned.length + 400);
      } else if (fillStage === "narrative") {
        sys =
          `너는 대한민국 건설안전 기술사다. 반드시 JSON만 출력한다. 마크다운·서론 금지.\n` +
          `출력 스키마: {"items":[{"sub_work":"세부작업","hazard_factor":"위험요인","hazard_situation":"위험발생상황",` +
          `"existing_control":"현재안전대책","improvement_control":"개선대책"}]}\n` +
          `등급·PPE·법적근거는 넣지 않는다. 입력된 세부작업·위험요인을 유지한다.\n` +
          `단, 위험요인이 작업중단·공정지연이거나 음역어·조어면 원인+재해결과의 표준 한국어로만 교정한다.\n` +
          `발생상황·대책은 현장 행위·위치·조건이 드러나게 구체적으로(각 2~3문장). 추상문구 금지.`;
        user =
          `[입력] 공종:${process_name} / 장비:${equipText} / 작업:${descText} / 위치:${locationText} / 환경:${envText}\n\n` +
          `[초안 목록]\n${listText}\n\n` +
          `위 ${cleaned.length}건 각각에 발생상황·현재대책·개선대책만 채워 JSON items로 반환하라.\n` +
          `항목 수·순서 동일. 공학적·관리적 대책을 구분하여 쓸 것.`;
        maxTokens = Math.min(3200, 900 * cleaned.length + 500);
      } else {
        // all — single call (compat): richer narrative + meta
        sys =
          `너는 대한민국 건설안전 기술사다. 반드시 JSON만 출력한다. 마크다운·서론 금지.\n` +
          `출력 스키마: {"items":[{"sub_work":"세부작업","hazard_factor":"위험요인","hazard_situation":"위험발생상황",` +
          `"existing_control":"현재안전대책","improvement_control":"개선대책",` +
          `"initial_likelihood":"상|중|하","initial_severity":"상|중|하",` +
          `"residual_likelihood":"상|중|하","residual_severity":"상|중|하",` +
          `"ppe":["보호구"],"legal_basis":["법적근거 조항"]}]}\n` +
          `입력된 세부작업·위험요인을 유지한다. 발생상황·대책은 2~3문장으로 구체적으로.\n` +
          `등급·PPE·법적근거는 짧게. legal_basis는 산안기준규칙 제OOO조 또는 KOSHA GUIDE.`;
        user =
          `[입력] 공종:${process_name} / 장비:${equipText} / 작업:${descText} / 위치:${locationText} / 환경:${envText}\n\n` +
          `[초안 목록]\n${listText}\n\n` +
          `위 ${cleaned.length}건을 채워 JSON items로 반환하라. 항목 수·순서 동일.`;
        maxTokens = Math.min(3600, 1000 * cleaned.length + 500);
      }

      const mapFillItems = (content: string) => {
        const parsed = parseDeepseekRiskJson<any>(content);
        let rawItems: any[] = [];
        if (Array.isArray(parsed)) rawItems = parsed;
        else if (parsed && Array.isArray(parsed.items)) rawItems = parsed.items;

        return rawItems
          .map((raw: any, idx: number) => {
            if (!raw || typeof raw !== "object") return null;
            const fallback = cleaned[idx];
            raw.sub_work = raw.sub_work || raw.sub_task || fallback?.sub_task;
            raw.hazard_factor = raw.hazard_factor || raw.hazard || fallback?.hazard;
            raw.process = raw.process || process_name;

            if (fillStage === "meta") {
              const sub = String(raw.sub_work || fallback?.sub_task || "").trim();
              const hazard = String(raw.hazard_factor || fallback?.hazard || "").trim();
              if (!sub) return null;
              let likelihood = String(raw.initial_likelihood || raw.likelihood_grade || "중").trim();
              let severity = String(raw.initial_severity || raw.severity_grade || "중").trim();
              if (!["상", "중", "하"].includes(likelihood)) likelihood = "중";
              if (!["상", "중", "하"].includes(severity)) severity = "중";
              const improvedLikelihood = String(raw.residual_likelihood || raw.improved_likelihood_grade || "하").trim();
              const improvedSeverity = String(raw.residual_severity || raw.improved_severity_grade || "하").trim();
              const ppeRaw = raw.ppe ?? [];
              const ppe = Array.isArray(ppeRaw) ? ppeRaw.map(String).filter(Boolean) : [];
              const legalRaw = raw.legal_basis ?? [];
              const legal_basis = Array.isArray(legalRaw) ? legalRaw.map(String).filter(Boolean) : [];
              return {
                process: process_name,
                sub_task: sub,
                hazard: hazard || `${sub} 관련 위험`,
                hazard_situation: fallback?.hazard_situation || "",
                existing_measure: fallback?.existing_measure || "",
                improvement_measure: fallback?.improvement_measure || "",
                likelihood_grade: likelihood,
                severity_grade: severity,
                improved_likelihood_grade: ["상", "중", "하"].includes(improvedLikelihood) ? improvedLikelihood : "하",
                improved_severity_grade: ["상", "중", "하"].includes(improvedSeverity) ? improvedSeverity : "하",
                ppe: ppe.length ? ppe : ["안전모", "안전화"],
                legal_basis,
                fill_stage: "meta",
              };
            }

            if (fillStage === "narrative") {
              const sub = String(raw.sub_work || fallback?.sub_task || "").trim();
              const hazard = String(raw.hazard_factor || fallback?.hazard || "").trim();
              const situation = String(raw.hazard_situation || "").trim();
              const existing = String(raw.existing_control || raw.existing_measure || "").trim();
              const improvement = String(raw.improvement_control || raw.improvement_measure || "").trim();
              if (!sub || !hazard) return null;
              return {
                process: process_name,
                sub_task: sub,
                hazard,
                hazard_situation: situation || `${sub} 중 위험 상황`,
                existing_measure: existing || "현장 통상 안전조치",
                improvement_measure: improvement || "구체적 개선조치 보완 필요",
                likelihood_grade: "중",
                severity_grade: "중",
                improved_likelihood_grade: "하",
                improved_severity_grade: "하",
                ppe: [],
                legal_basis: [],
                fill_stage: "narrative",
              };
            }

            let mapped = mapRawItem(raw, process_name);
            if (!mapped && fallback) {
              mapped = {
                process: process_name,
                sub_task: fallback.sub_task,
                hazard: fallback.hazard || String(raw.hazard_factor || raw.hazard || "").trim() || `${fallback.sub_task} 위험`,
                hazard_situation: String(raw.hazard_situation || "").trim() || `${fallback.sub_task} 중 위험 상황`,
                existing_measure: String(raw.existing_control || raw.existing_measure || "").trim() || "현장 통상 안전조치",
                improvement_measure: String(raw.improvement_control || raw.improvement_measure || "").trim() || "구체적 개선조치 보완 필요",
                likelihood_grade: "중",
                severity_grade: "중",
                risk_grade: "중",
                improved_likelihood_grade: "하",
                improved_severity_grade: "하",
                improved_risk_grade: "하",
                frequency: 3,
                severity: 3,
                improved_frequency: 1,
                improved_severity: 1,
                ppe: Array.isArray(raw.ppe) ? raw.ppe.map(String) : ["안전모", "안전화"],
                legal_basis: Array.isArray(raw.legal_basis) ? raw.legal_basis.map(String).filter(Boolean) : [],
              };
            }
            return mapped;
          })
          .filter(Boolean);
      };

      try {
        const deep = await callDeepseekRiskChat({
          messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
          temperature: 0.2,
          max_tokens: maxTokens,
          timeoutMs: 40_000,
          maxAttempts: 1,
        });
        const content = deep.content;
        if (deep.fallbackFrom) {
          console.log(`risk_fill used model=${deep.model} (from ${deep.fallbackFrom})`);
        }

        const items = mapFillItems(content);

        if (items.length === 0) {
          return new Response(
            JSON.stringify({ error: "채움 결과를 생성하지 못했습니다.", items: [] }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } },
          );
        }

        return new Response(
          JSON.stringify({
            items,
            count: items.length,
            normalized_equipment: normalizedEquipment,
            mode: "risk_fill",
            fill_stage: fillStage,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } },
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        console.error("risk_fill error:", e);
        return new Response(JSON.stringify({ error: msg }), {
          status: e instanceof DeepseekRiskError ? e.status || 500 : 500,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        });
      }
    }

    // ============ Phase 1 (legacy): JSA timeline only (fast JSON, ~1–3s) ============
    if (mode === "jsa_timeline") {
      const guideCount = jsaGuideCount(detailLevel);
      const sys =
        `너는 건설현장 JSA 전문가다. 반드시 JSON만 출력한다. 마크다운 금지.\n` +
        `출력 스키마: {"sub_tasks":["세부작업1","세부작업2",...]}`;
      const user =
        `[입력] 공종:${process_name} / 장비:${equipText} / 작업:${descText} / 위치:${locationText} / 환경:${envText}\n\n` +
        `위 공종의 시간순(작업 전 준비→본 작업→마무리) 세부작업명만 ${guideCount}개 내외로 나열하라.\n` +
        `위험요인·대책·설명 금지. sub_tasks 문자열 배열만.`;

      try {
        const { content } = await callDeepseekRiskChat({
          messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
          temperature: 0.2,
          max_tokens: 900,
          timeoutMs: 35_000,
        });
        const parsed = parseDeepseekRiskJson<any>(content);
        let subTasks: string[] = [];
        if (Array.isArray(parsed)) {
          subTasks = parsed.map((x) => String(x ?? "").trim()).filter(Boolean);
        } else if (parsed && Array.isArray(parsed.sub_tasks)) {
          subTasks = parsed.sub_tasks.map((x: any) => String(x ?? "").trim()).filter(Boolean);
        }
        // Strip leading numbering like "1. "
        subTasks = subTasks
          .map((s) => s.replace(/^\d+[\.\)]\s*/, "").trim())
          .filter(Boolean)
          .slice(0, detailLevel === "comprehensive" ? 14 : 10);

        if (subTasks.length === 0) {
          return new Response(
            JSON.stringify({ error: "세부작업 목록을 생성하지 못했습니다.", sub_tasks: [] }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } },
          );
        }

        return new Response(
          JSON.stringify({
            sub_tasks: subTasks,
            count: subTasks.length,
            normalized_equipment: normalizedEquipment,
            mode: "jsa_timeline",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } },
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        console.error("jsa_timeline error:", e);
        return new Response(JSON.stringify({ error: msg }), {
          status: e instanceof DeepseekRiskError ? e.status || 500 : 500,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        });
      }
    }

    // ============ Phase 2: single sub_task risk row (fast JSON, ~3–8s) ============
    if (mode === "risk_row") {
      const st = String(sub_task || "").trim();
      if (!st) {
        return new Response(JSON.stringify({ error: "세부작업(sub_task)이 필요합니다." }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        });
      }

      const sys =
        `너는 대한민국 건설안전 기술사다. 반드시 JSON 객체 하나만 출력한다. 마크다운·배열·서론 금지.\n` +
        `스키마 키(필수): process, sub_work, hazard_factor, hazard_situation, existing_control, improvement_control, ` +
        `initial_likelihood, initial_severity, residual_likelihood, residual_severity, ppe, legal_basis\n` +
        `likelihood/severity는 상|중|하. ppe는 문자열 또는 배열. legal_basis는 조항 문자열 배열.\n` +
        `[법적 근거 필수 — 위반 시 무효]\n` +
        `1) hazard_situation 과 improvement_control 문장에는 반드시 구체적인 법적 근거를 ` +
        `문장 첫머리 또는 괄호 안에 명시한다.\n` +
        `2) 허용 형식 예: [산업안전보건기준에 관한 규칙 제225조], (산안기준규칙 제38조), [KOSHA GUIDE C-42-2021]\n` +
        `3) "안전수칙 준수" 같은 추상 문구만 쓰면 안 된다. 조항 번호가 없는 문장은 금지.\n` +
        `4) legal_basis 배열에도 동일 조항을 넣는다.\n` +
        `예시 improvement_control: "(산안기준규칙 제225조) 이동식 국소배기장치를 용접점 30cm 이내에 설치하고 흡입 풍속을 유지한다."\n` +
        `예시 hazard_situation: "[산업안전보건기준에 관한 규칙 제42조] 개구부 난간·덮개 미설치 상태에서 보행 중 추락."`;
      const user =
        `[입력] 공종:${process_name} / 세부작업:${st} / 장비:${equipText} / 작업:${descText} / 위치:${locationText} / 환경:${envText}\n\n` +
        `위 세부작업 1건에 대한 위험성평가만 작성하라.\n` +
        `추상문구 금지. 공학·관리·PPE 포함.\n` +
        `hazard_situation·improvement_control에 [산안기준규칙 제OOO조] 또는 [KOSHA GUIDE] 조항을 반드시 명시하고 legal_basis에도 넣으라.`;

      try {
        const { content } = await callDeepseekRiskChat({
          messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
          temperature: 0.25,
          max_tokens: 1800,
          timeoutMs: 45_000,
        });
        const parsed = parseDeepseekRiskJson<any>(content);
        const raw = Array.isArray(parsed) ? parsed[0] : parsed?.item || parsed;
        if (!raw || typeof raw !== "object") {
          return new Response(JSON.stringify({ error: "행 데이터를 파싱하지 못했습니다." }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
          });
        }
        // Ensure sub_work matches requested step
        raw.sub_work = raw.sub_work || raw.sub_task || st;
        raw.process = raw.process || process_name;
        const mapped = mapRawItem(raw, process_name);
        if (!mapped) {
          // Soft-accept minimally filled row rather than fail the whole parallel batch
          const soft = {
            process: process_name,
            sub_task: st,
            hazard: String(raw.hazard_factor || raw.hazard || "위험요인 확인 필요").trim() || "위험요인 확인 필요",
            hazard_situation: String(raw.hazard_situation || "").trim() || `${st} 중 위험 상황 발생`,
            existing_measure: String(raw.existing_control || raw.existing_measure || "").trim() || "작업 전 점검 및 보호구 착용",
            improvement_measure:
              String(raw.improvement_control || raw.improvement_measure || "").trim() ||
              "공학적 방호·관리적 통제·PPE를 병행한다",
            likelihood_grade: "중",
            severity_grade: "중",
            improved_likelihood_grade: "하",
            improved_severity_grade: "하",
            ppe: ["안전모", "안전화"],
            legal_basis: [] as string[],
          };
          // Soft row: still try to keep any legal strings the model emitted
          const softLegal = raw.legal_basis ?? raw["법적근거"];
          if (Array.isArray(softLegal)) soft.legal_basis = softLegal.map(String).filter(Boolean);
          else if (typeof softLegal === "string" && softLegal.trim()) soft.legal_basis = [softLegal.trim()];
          return new Response(
            JSON.stringify({ item: soft, normalized_equipment: normalizedEquipment, mode: "risk_row" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } },
          );
        }
        return new Response(
          JSON.stringify({ item: mapped, normalized_equipment: normalizedEquipment, mode: "risk_row" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } },
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Unknown error";
        console.error("risk_row error:", e);
        return new Response(JSON.stringify({ error: msg }), {
          status: e instanceof DeepseekRiskError ? e.status || 500 : 500,
          headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" },
        });
      }
    }

    // ============ Legacy Risk Assessment Mode: One-Shot JSA + SSE ============
    // Kept for compatibility; UI prefers jsa_timeline + risk_row parallel path.
    // Stream DeepSeek deltas; emit each completed item over SSE to avoid 150s idle/non-stream timeout.

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
        const startedAt = Date.now();
        let emitted = 0;
        const heartbeat = setInterval(() => {
          const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
          try {
            controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
            // Visible keepalive — comment pings alone do not update the UI.
            // Until the first item arrives, show wait progress so users don't see a frozen "시작…".
            if (emitted === 0) {
              send({
                type: "status",
                message: `AI 응답 대기 중… ${elapsedSec}초`,
                items_so_far: 0,
                elapsed_sec: elapsedSec,
              });
            }
          } catch {
            /* closed */
          }
        }, 3000);

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
            thinking: false,
          });
          send({ type: "status", message: "위험성평가 AI 스트리밍 생성 시작…" });

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
            (message, extra) => {
              send({
                type: "status",
                message,
                items_so_far: emitted,
                ...(extra || {}),
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
              "NVIDIA API 키가 유효하지 않습니다. NVIDIA_API_KEY(Supabase Edge Secrets)를 확인해야 합니다.";
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
        JSON.stringify({ error: "NVIDIA API 키가 유효하지 않습니다. NVIDIA_API_KEY(Supabase Edge Secrets)를 확인해야 합니다." }),
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
