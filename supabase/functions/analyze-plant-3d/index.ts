// Master-only: Air Liquide 3D Plant Model (IFC/OBJ/STL/GLB) AI Clash, Operability & Safety Spacing Reviewer.

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
    const fileName = String(body?.fileName || "model.ifc");
    const elements = Array.isArray(body?.elements) ? body.elements.slice(0, 60) : [];
    const preChecks = Array.isArray(body?.preChecks) ? body.preChecks : [];
    const gasContext = String(body?.gasContext || "산업가스(LOX/H2/N2)");

    const prompt = `당신은 에어리퀴드(Air Liquide) 산업가스 플랜트의 수석 3D 배관·배치(Plant Layout / PDMS / E3D / BIM) 및 공정안전 엔지니어입니다.
아래 3D 모델에서 추출된 설비·배관·밸브·PSV·구조물 좌표(단위: m, z=바닥 기준 설치높이 EL)와 자동 간섭 사전진단 결과를 바탕으로, 시공 착공 전 반드시 수정해야 할 3D 설계 검토 리포트를 JSON으로 작성하세요.

파일명: ${fileName}
대상 가스/공정: ${gasContext}
추출 3D 객체 목록:
${JSON.stringify(elements, null, 1).slice(0, 8000)}

자동 사전진단(Clash/높이):
${JSON.stringify(preChecks, null, 1).slice(0, 2500)}

반드시 아래 JSON 형식만 반환하세요:
{
  "overall_verdict": "시공 가능" | "수정 후 시공" | "중대 간섭·안전 결함(재설계)",
  "executive_summary": string,
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "category": "간섭(Clash)" | "접근성·운전성" | "이격거리·방폭" | "서포트·열수축" | "시공성",
      "target_elements": string,
      "title": string,
      "detail": string,
      "rule_ref": string,
      "how_to_fix": string
    }
  ],
  "constructability_checklist": string[]
}`;

    const { parsed, model } = await callGeminiEngineeringJson({
      prompt,
      temperature: 0.15,
      maxOutputTokens: 4096,
    });

    return json({ ok: true, model, result: parsed });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
});
