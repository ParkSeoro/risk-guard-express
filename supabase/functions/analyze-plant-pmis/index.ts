// Master-only: Air Liquide Construction PMIS AI Auditor (Manpower Daily Report + Progress Claim Review).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callGeminiEngineeringJson } from "../_shared/geminiNative.ts";

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
    const manpower = Array.isArray(body?.manpower) ? body.manpower : [];
    const claims = Array.isArray(body?.claims) ? body.claims : [];
    const anomalies = Array.isArray(body?.anomalies) ? body.anomalies : [];

    const prompt = `당신은 에어리퀴드(Air Liquide) 플랜트 건설현장의 수석 사업관리(PMIS)·원가·안전보건 총괄 디렉터 AI 어드바이저입니다.
시공사가 제출한 출역일보(인원보고)와 금회 기성청구서, 그리고 자동 탐지된 이상징후를 교차 분석하여 발주처 승인/감액 검토 의견서를 JSON으로 작성하세요.

[출역일보(인원보고)]
${JSON.stringify(manpower, null, 1).slice(0, 4000)}

[기성청구서]
${JSON.stringify(claims, null, 1).slice(0, 4000)}

[자동 탐지 이상징후]
${JSON.stringify(anomalies, null, 1).slice(0, 3000)}

반드시 아래 JSON 형식만 반환하세요:
{
  "approval_recommendation": "원안 승인" | "조건부 일부 감액 승인" | "반려 및 재검측 요구",
  "executive_opinion": string,
  "key_risks": [
    { "severity": "critical" | "warning", "trade": string, "title": string, "detail": string, "action": string }
  ],
  "contractor_notice_draft": string
}`;

    const { parsed, model } = await callGeminiEngineeringJson({
      prompt,
      temperature: 0.15,
      maxOutputTokens: 3072,
    });

    return json({ ok: true, model, result: parsed });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
});
