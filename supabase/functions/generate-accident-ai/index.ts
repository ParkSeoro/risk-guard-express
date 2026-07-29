import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { streamGeminiChatText, GeminiError } from "../_shared/gemini.ts";
import {
  buildAccidentCacheKey,
  fetchApprovedAccidentCases,
} from "../_shared/aiResponseCache.ts";

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

/** KOSHA 중대재해 보고서 스타일 — 사고사례 전용. 위험성평가 행 생성 금지. */
const ACCIDENT_SYSTEM_PROMPT = `/no_think
너는 안전보건공단(KOSHA) 중대재해 조사관을 20년 수행한 전문가다.
목적: 해당 공종의 치명 중대재해 사례를 뉴스 기사처럼 구체·현실감 있게 엄선 생성.

[절대 규칙]
1. 갯수 채우기식·뻔한 데이터를 수십 개 만들지 말 것. 가장 치명적인 실제 발생 포맷 사례를 딱 3~4개만 엄선.
2. 각 사례에 occurrence_date(발생일자 YYYY-MM-DD), location(발생장소), accident_summary(사고개요), title(사고명), cause(원인), result(결과·피해), prevention(대책) 필수.
3. 사고개요는 뉴스 기사처럼 누가·어디서·무엇을·어떻게·결과가 드러나게 구체 창작. 허구여도 현실감 유지.
4. 원인·대책은 실무·기술적 관점의 개조식(명사형 종결: '~함','~미흡','~조치'). 서술형(~합니다/~할 것) 금지.
5. 위험성평가 테이블(items) 출력 금지. 프롬프트 지시어 누수 금지.
6. 출력은 오직 JSON. 코드펜스·설명문 금지. 100% 한국어.`;

function tryParse(s: string): any {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function sseEncode(encoder: TextEncoder, payload: Record<string, unknown>): Uint8Array {
  return encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
}

function normalizeAccident(c: any): any | null {
  const title = String(c.title || c["제목"] || c["사고명"] || c.accident_type || "").trim();
  const occurrence_date = String(c.occurrence_date || c["발생일자"] || c["발생일"] || "").trim();
  const location = String(c.location || c["발생장소"] || c["장소"] || "").trim();
  const accident_summary = String(
    c.accident_summary || c["사고개요"] || c.summary || c.description || "",
  ).trim();
  const cause = String(c.cause || c["원인"] || c["발생원인"] || "").trim();
  const result = String(c.result || c["결과"] || c["피해"] || "").trim();
  const prevention = String(c.prevention || c["대책"] || c["예방대책"] || c["재발방지"] || "").trim();

  if (!title && !accident_summary && !cause) return null;

  // Normalize date to YYYY-MM-DD when possible
  let dateOut = occurrence_date;
  const dm = occurrence_date.match(/(\d{4})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})/);
  if (dm) {
    dateOut = `${dm[1]}-${dm[2].padStart(2, "0")}-${dm[3].padStart(2, "0")}`;
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(occurrence_date)) {
    // Deterministic fallback from title hash (no Math.random)
    let h = 0;
    const seed = title || cause || "accident";
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    const y = 2018 + (h % 7);
    const m = String(1 + (h % 12)).padStart(2, "0");
    const d = String(1 + ((h >> 4) % 28)).padStart(2, "0");
    dateOut = `${y}-${m}-${d}`;
  }

  return {
    title: title || "중대재해 사례",
    occurrence_date: dateOut,
    location: location || "국내 건설현장",
    accident_summary: accident_summary || `${cause}로 ${result || "중대재해 발생"}`.trim(),
    cause,
    result,
    prevention: prevention || "작업전 위험성평가 재실시 · 본질안전·공학적 통제 우선 조치",
  };
}

/** Extract completed objects from growing accident_cases array in stream buffer. */
function extractCompletedAccidents(buffer: string, alreadyEmitted: number): { objects: any[]; nextIndex: number } {
  const cleaned = buffer.replace(/```json/gi, "").replace(/```/g, "");
  const keyMatch = cleaned.search(/"accident_cases"\s*:|"items"\s*:|"사고사례"\s*:/);
  let arrStart = -1;
  if (keyMatch >= 0) {
    arrStart = cleaned.indexOf("[", keyMatch);
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
      process_name,
      process,
      equipment,
      work_description,
      work_location,
      project_id,
      stream: streamFlag,
    } = body;

    const processName = String(process_name || process || "").trim();
    if (!processName) {
      return new Response(JSON.stringify({ error: "공종명이 필요합니다." }), {
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

    const equipText = String(equipment || "").trim() || "해당 공종 일반 장비";
    const descText = String(work_description || "").trim() || `${processName} 관련 작업`;
    const locationHint = String(work_location || "").trim() || "국내 건설현장";
    const wantStream = streamFlag !== false;

    const adminClient = createClient(supabaseUrl, supabaseKey);
    const cacheKey = buildAccidentCacheKey({
      process_name: processName,
      equipment: equipText,
      work_description: descText,
    });

    // 1) Exact cache hit
    const { data: cached } = await adminClient
      .from("ai_accident_cache")
      .select("*")
      .eq("cache_key", cacheKey)
      .maybeSingle();
    const cachedCases = (cached?.generated_cases as any[]) || [];

    // 2) Approved corpus (assessment_accidents) — skip LLM when enough cases exist
    const libraryCases =
      cachedCases.length >= 3
        ? []
        : await fetchApprovedAccidentCases(adminClient, processName, 4);

    const emitCached = async (
      send: (payload: Record<string, unknown>) => void,
      cases: any[],
      source: string,
    ) => {
      send({ type: "meta", source, mode: "accident", process: processName });
      for (const c of cases) send({ type: "item", item: c, mode: "accident" });
      send({ type: "done", source, count: cases.length, mode: "accident", is_complete: true });
      if (source === "library") {
        await adminClient.from("ai_accident_cache").upsert(
          {
            cache_key: cacheKey,
            process_name: processName,
            generated_cases: cases,
            source: "library",
            project_id: project_id || null,
            hit_count: 1,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "cache_key" },
        );
      } else if (cached?.id) {
        await adminClient
          .from("ai_accident_cache")
          .update({ hit_count: (cached.hit_count || 0) + 1 })
          .eq("id", cached.id);
      }
    };

    const userPrompt = `[입력]
공종: ${processName}
장비: ${equipText}
작업내용: ${descText}
작업위치 힌트: ${locationHint}

[요구]
- KOSHA 중대재해 보고서/뉴스 포맷의 치명 사례 딱 3~4개만 엄선 생성
- 각 사례: occurrence_date, location, accident_summary, title, cause, result, prevention
- 원인·대책 개조식. 위험성평가 items 금지.

[출력 JSON]
{"accident_cases":[{"occurrence_date":"2019-07-15","location":"경기도 ○○시 ○○신축공사 지하 2층","accident_summary":"누가 어디서 무엇을 하다 어떻게 되어 결과가…","title":"사고명(재해형태)","cause":"직접·간접원인 개조식","result":"인명·물적 피해 개조식","prevention":"재발방지 기술·관리 조치 개조식"}]}`;

    const runGeneration = async (send: (payload: Record<string, unknown>) => void) => {
      if (cachedCases.length >= 3) {
        await emitCached(send, cachedCases, "cache");
        return;
      }
      if (libraryCases.length >= 3) {
        await emitCached(send, libraryCases, "library");
        return;
      }

      send({ type: "meta", source: "ai", mode: "accident", process: processName });

      let buffer = "";
      let emitted = 0;
      const collected: any[] = [];
      const seenTitles = new Set<string>();

      const emitOne = (raw: any) => {
        const mapped = normalizeAccident(raw);
        if (!mapped) return;
        if (seenTitles.has(mapped.title)) return;
        if (collected.length >= 4) return;
        seenTitles.add(mapped.title);
        collected.push(mapped);
        send({ type: "accident", accident: mapped });
      };

      try {
        for await (const chunk of streamGeminiChatText({
          messages: [
            { role: "system", content: ACCIDENT_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.55,
          max_tokens: 3500,
          response_format: { type: "json_object" },
          compact: true,
        })) {
          buffer += chunk;
          const { objects, nextIndex } = extractCompletedAccidents(buffer, emitted);
          for (const obj of objects) emitOne(obj);
          emitted = nextIndex;
        }
      } catch (e) {
        if (e instanceof GeminiError) {
          if (e.code === "RATE_LIMIT") throw new Error("RATE_LIMIT");
          if (e.code === "QUOTA_EXHAUSTED") throw new Error("CREDITS_EXHAUSTED");
          if (e.code === "INVALID_KEY") throw new Error("INVALID_KEY");
        }
        throw e;
      }

      const finalParsed = tryParse(buffer.replace(/```json/gi, "").replace(/```/g, "").trim()) ||
        (() => {
          const m = buffer.match(/\{[\s\S]*\}/);
          return m ? tryParse(m[0]) : null;
        })();

      const arr =
        (Array.isArray(finalParsed?.accident_cases) && finalParsed.accident_cases) ||
        (Array.isArray(finalParsed?.items) && finalParsed.items) ||
        (Array.isArray(finalParsed?.["사고사례"]) && finalParsed["사고사례"]) ||
        [];

      for (let i = emitted; i < arr.length; i++) emitOne(arr[i]);

      if (collected.length === 0) {
        send({
          type: "error",
          error: "AI가 유효한 사고사례를 생성하지 못했습니다. 잠시 후 다시 시도해주세요.",
        });
        return;
      }

      send({
        type: "done",
        source: "ai",
        mode: "accident",
        count: collected.length,
        accident_cases: collected,
        is_complete: true,
      });

      await adminClient.from("ai_accident_cache").upsert(
        {
          cache_key: cacheKey,
          process_name: processName,
          generated_cases: collected,
          source: "ai",
          project_id: project_id || null,
          hit_count: 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "cache_key" },
      );
    };

    if (wantStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const send = (payload: Record<string, unknown>) => {
            controller.enqueue(sseEncode(encoder, payload));
          };
          try {
            controller.enqueue(encoder.encode(`: connected\n\n`));
            await runGeneration(send);
          } catch (e) {
            console.error("generate-accident-ai stream error:", e);
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
            } catch { /* ignore */ }
          } finally {
            try {
              controller.close();
            } catch { /* ignore */ }
          }
        },
      });
      return new Response(stream, { headers: sseHeaders });
    }

    const collected: any[] = [];
    await runGeneration((payload) => {
      if (payload.type === "accident" && payload.accident) collected.push(payload.accident);
      if (payload.type === "error") throw new Error(String(payload.error));
    });

    return new Response(
      JSON.stringify({
        items: collected,
        accident_cases: collected,
        count: collected.length,
        source: "ai",
        mode: "accident",
        is_complete: true,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json; charset=utf-8" } },
    );
  } catch (e) {
    console.error("generate-accident-ai error:", e);
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
