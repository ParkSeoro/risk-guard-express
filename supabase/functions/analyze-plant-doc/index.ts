// Master-only: Air Liquide Universal Construction/Plant Document AI Analyzer & Diff Reviewer.
// Supports single-document deep review AND Rev.0 vs Rev.1 impact comparison.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  geminiGenerateContentUrl,
  geminiRequestHeaders,
  resolveGeminiApiKey,
  resolveGeminiVisionModel,
} from "../_shared/geminiNative.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildDocPrompt(payload: {
  mode: "single" | "compare";
  docAName: string;
  docAText: string;
  docBName?: string;
  docBText?: string;
}): string {
  const aClip = payload.docAText.slice(0, 14000);
  if (payload.mode === "compare" && payload.docBText) {
    const bClip = payload.docBText.slice(0, 14000);
    return `당신은 에어리퀴드(Air Liquide) 산업가스 플랜트 건설 프로젝트의 수석 계약·공정안전·품질 검토 전문가입니다.
아래 기준 문서(Rev.0)와 비교 문서(Rev.1 / 시공사 제출본)를 정밀 대조하여, 발주처(에어리퀴드) 입장에서 숨겨진 비용 증액 함정, 안전·품질 기준 하향(O2 탈지 삭제, RT% 축소, PSV 누락 등), 공기 지연 및 법적 리스크를 적발하세요.

[기준 문서(Rev.0): ${payload.docAName}]
${aClip}

[비교 문서(Rev.1): ${payload.docBName || "비교문서"}]
${bClip}

반드시 아래 JSON 형식만 반환하세요:
{
  "executive_summary": string,
  "key_specs": [{ "label": string, "value": string }],
  "risk_findings": [
    {
      "severity": "critical" | "warning" | "info",
      "category": "안전·법규" | "비용·물량" | "품질·NDT" | "공기·계약" | "기술스펙",
      "title": string,
      "detail": string,
      "recommendation": string
    }
  ],
  "action_items": string[]
}`;
  }

  return `당신은 에어리퀴드(Air Liquide) 산업가스 플랜트 건설 프로젝트의 수석 엔지니어이자 대한민국 산안법·고압가스법·건진법 최고 전문가입니다.
아래 문서를 분석하여 핵심 요약, 주요 기술·계약 스펙, 숨겨진 안전/법적/비용 리스크, 그리고 즉시 확인해야 할 조치 사항을 JSON으로 반환하세요.

[문서명: ${payload.docAName}]
${aClip}

반드시 아래 JSON 형식만 반환하세요:
{
  "executive_summary": string,
  "key_specs": [{ "label": string, "value": string }],
  "risk_findings": [
    {
      "severity": "critical" | "warning" | "info",
      "category": "안전·법규" | "비용·물량" | "품질·NDT" | "공기·계약" | "기술스펙",
      "title": string,
      "detail": string,
      "recommendation": string
    }
  ],
  "action_items": string[]
}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const supabaseService = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    const userClient = createClient(supabaseUrl, supabaseAnon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: authErr } = await userClient.auth.getUser();
    if (authErr || !userData?.user) return json({ error: "Unauthorized" }, 401);

    const adminClient = createClient(supabaseUrl, supabaseService);
    const { data: roleRows } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id);
    const isMaster = (roleRows || []).some((r: { role: string }) => r.role === "master");
    if (!isMaster) return json({ error: "Forbidden: Master-only private lab" }, 403);

    const body = await req.json();
    const mode: "single" | "compare" = body?.mode === "compare" ? "compare" : "single";
    const docAName = String(body?.docAName || "문서A");
    const docAText = String(body?.docAText || "").trim();
    const docBName = body?.docBName ? String(body.docBName) : undefined;
    const docBText = body?.docBText ? String(body.docBText).trim() : undefined;

    if (!docAText) return json({ error: "분석할 문서 텍스트가 비어 있습니다." }, 400);

    const apiKey = await resolveGeminiApiKey();
    if (!apiKey) return json({ error: "GEMINI_API_KEY가 설정되지 않았습니다." }, 500);

    const model = resolveGeminiVisionModel();
    const prompt = buildDocPrompt({ mode, docAName, docAText, docBName, docBText });

    const resp = await fetch(geminiGenerateContentUrl(model), {
      method: "POST",
      headers: geminiRequestHeaders(apiKey),
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.15,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!resp.ok) {
      const errTxt = await resp.text();
      return json({ error: `Gemini API 오류 (${resp.status})`, detail: errTxt.slice(0, 300) }, 502);
    }

    const data = await resp.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const parsed = JSON.parse(rawText);
    return json({ ok: true, result: parsed });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
});
