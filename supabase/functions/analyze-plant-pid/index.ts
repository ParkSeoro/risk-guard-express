// Master-only: Air Liquide AI P&ID / ISO Drawing Topology Extractor & Design Auditor.
// Reads user-uploaded P&ID/ISO drawings & design basis, builds an executable simulator circuit,
// and audits what is right, what is wrong/missing, and how to fix it (As-Is vs To-Be).

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

function buildPidPrompt(opts: {
  fileName: string;
  gasHint?: string;
  processNotes?: string;
  extractedTextHint?: string;
}): string {
  return `당신은 에어리퀴드(Air Liquide) 산업가스 플랜트(H2, LH2, O2, LOX, N2, LIN, LAR, LCO2, 특수가스)의 수석 공정안전(PSM/HAZOP) 및 P&ID 설계 엔지니어입니다.
사용자가 업로드한 실제 도면(P&ID 또는 Piping ISO)과 운전·설계 조건 자료를 정밀 판독하여 다음 두 가지를 수행하세요:
1. 도면에 실제로 그려진 설비·밸브·PSV·역지밸브·배관 연결 구조를 그대로 **실행 가능한 운전 시뮬레이터 회로(circuit)**로 추출합니다.
2. 이 도면과 자료가 **정상적으로 설계된 부분**, **잘못되었거나 누락된 부분(PSV 누락, 극저온 액봉, 산소탈지/재질, 역지밸브, LCO2 삼중점, 방폭/이격, 과압 보호 등)**, 그리고 **어떻게 수정해야 안전한지(개선 조치안)**를 대한민국 고압가스법(KGS FP111)·산안법·API 520/521·EIGA 기준으로 정확히 판정합니다.

[입력 정보]
- 파일명: ${opts.fileName}
- 가스 힌트: ${opts.gasHint || "auto"}
- 사용자 추가 운전조건/설계 메모: ${opts.processNotes?.trim() || "없음"}
- PDF 추출 텍스트 참고: ${(opts.extractedTextHint || "").slice(0, 4000) || "없음"}

[회로 추출 규칙]
- nodes는 왼쪽(공급원)에서 오른쪽(수요처) 흐름 순서대로 4~8개의 핵심 노드로 구성하세요.
- kind는 반드시 "source" | "valve" | "check_valve" | "equipment" | "psv" | "consumer" 중 하나만 사용하세요.
- 도면에 PSV가 실제로 없다면, 위험한 구간(예: 이중 차단 극저온 구간 또는 압축기 토출 구간)을 보호하는 가상 위치에 kind:"psv", psvInstalled:false 로 1개 배치하여 시뮬레이터에서 "도면 원안(미설치)"과 "AI 보완안(설치)"을 비교할 수 있게 하세요.
- segments는 메인 유로 노드들(psv 제외)을 순서대로 연결하는 배관 구간입니다. 각 구간에 mawpBar(설계압력 bar), isCryoLiquidSection(극저온 액체 구간 여부), isDischargeSection(압축기/펌프 토출 구간 여부)를 지정하세요.
- gas는 "LOX" | "LIN" | "LAR" | "H2" | "LH2" | "LCO2" | "N2" | "O2" 중 가장 가까운 코드로 지정하세요.

반드시 아래 JSON 형식만 반환하세요:
{
  "circuit": {
    "name": string,
    "subtitle": string,
    "gas": "LOX" | "LIN" | "LAR" | "H2" | "LH2" | "LCO2" | "N2" | "O2",
    "designPressureBar": number,
    "designTempC": number,
    "defaultInletPressureBar": number,
    "defaultAmbientHeatPct": number,
    "nodes": [
      {
        "id": string,
        "label": string,
        "tag": string,
        "kind": "source" | "valve" | "check_valve" | "equipment" | "psv" | "consumer",
        "isOpen": boolean,
        "psvInstalled": boolean,
        "psvSetBar": number,
        "protectsSegmentId": string,
        "checkHealthy": boolean,
        "equipmentType": "vaporizer" | "compressor" | "buffer_tank" | "pump"
      }
    ],
    "segments": [
      {
        "id": string,
        "label": string,
        "fromNodeId": string,
        "toNodeId": string,
        "sizeLabel": string,
        "mawpBar": number,
        "isCryoLiquidSection": boolean,
        "isDischargeSection": boolean
      }
    ],
    "scenarios": [
      {
        "id": string,
        "name": string,
        "description": string,
        "inletPressureBar": number,
        "ambientHeatPct": number,
        "valveStates": Record<string, boolean>,
        "psvStates": Record<string, boolean>,
        "checkValveStates": Record<string, boolean>,
        "downstreamBackpressureBar": number
      }
    ]
  },
  "design_audit": {
    "overall_verdict": "적정" | "보완 필요" | "설계 결함(위험)",
    "summary": string,
    "correct_items": [
      { "tag": string, "title": string, "detail": string }
    ],
    "defect_items": [
      {
        "severity": "critical" | "warning" | "info",
        "tag": string,
        "title": string,
        "detail": string,
        "rule_ref": string,
        "how_to_fix": string
      }
    ],
    "remediation_steps": string[]
  }
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
    const fileName = String(body?.fileName || "drawing.pdf");
    const gasHint = String(body?.gasHint || "auto");
    const processNotes = String(body?.processNotes || "");
    const extractedTextHint = String(body?.extractedTextHint || "");
    const images = Array.isArray(body?.images) ? body.images.slice(0, 2) : [];

    if (images.length === 0 && !extractedTextHint.trim() && !processNotes.trim()) {
      return json({ error: "도면 이미지(PDF/PNG/JPG) 또는 공정 설계 자료를 입력해 주세요." }, 400);
    }

    const prompt = buildPidPrompt({ fileName, gasHint, processNotes, extractedTextHint });
    const { parsed, model } = await callGeminiEngineeringJson({
      prompt,
      images,
      temperature: 0.15,
      maxOutputTokens: 6144,
      timeoutMs: 65_000,
    });

    return json({ ok: true, model, result: parsed });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 500);
  }
});
