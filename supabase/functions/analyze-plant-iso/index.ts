// Master-only: Air Liquide Industrial Gas Piping ISO Vision Analyzer.
// Extracts Title Block, BOM table, Weld counts, PSV/Valve topology hints, and safety design findings.

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

const MAX_IMAGES = 2;
const MAX_TOTAL_BASE64_CHARS = 4_500_000;
const VISION_TIMEOUT_MS = 35_000;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function buildIsoPrompt(opts: {
  fileName: string;
  gasHint?: string;
  extractedTextHint?: string;
}): string {
  const textHint = opts.extractedTextHint?.trim()
    ? `\n[PDF 추출 텍스트 참고]\n${opts.extractedTextHint.trim().slice(0, 3500)}`
    : "";

  return `당신은 에어리퀴드(Air Liquide) 산업가스 플랜트(H2, O2, N2, Ar, LCO2, 초저온 액화가스, 고압 배관)의 수석 배관·공정안전 엔지니어입니다.
첨부된 아이소메트릭(Piping ISO) 도면 이미지와 텍스트를 정밀 판독하여 아래 JSON 스키마로 정확히 추출하세요.

[절대 규칙]
1. 도면에 보이지 않는 숫자·라인번호·수량을 지어내지 마세요. 불명확하면 null을 반환하세요.
2. BOM(Bill of Materials) 표가 보이면 파이프(pipe), 엘보(elbow), 티(tee), 플랜지(flange), 밸브(valve), 안전밸브(psv), 볼트/가스켓(bolt_gasket), 서포트(support)로 분류해 모두 추출하세요.
3. 유체(fluid_gas)는 H2, LH2, O2, LOX, N2, LIN, Ar, LAR, LCO2, CO2, SiH4, NH3, AIR, STEAM, WATER 등 표준 코드로 정규화하세요.
4. 산소(O2/LOX) 탈지 표기(O2 CLEANING / DEGREASING), 초저온 차단밸브 사이 Thermal Relief PSV 유무, NDT(RT/PT/UT) 비율, PWHT 여부를 반드시 확인하세요.

파일명: ${opts.fileName}
사용자 지정 가스 힌트: ${opts.gasHint || "auto"}${textHint}

반드시 아래 JSON 형식만 반환하세요:
{
  "title_block": {
    "drawing_no": string | null,
    "line_no": string | null,
    "revision": string | null,
    "fluid_gas": string | null,
    "pipe_spec": string | null,
    "design_pressure_bar": number | null,
    "design_temp_c": number | null,
    "insulation_type": string | null,
    "nde_rt_percent": number | null,
    "pwht_required": boolean | null,
    "o2_cleaning_required": boolean | null
  },
  "welds": {
    "shop_weld_count": number,
    "field_weld_count": number
  },
  "topology_counts": {
    "psv_count": number,
    "block_valve_count": number,
    "check_valve_count": number,
    "vent_drain_count": number
  },
  "bom": [
    {
      "item_no": string,
      "category": "pipe" | "elbow" | "tee" | "reducer" | "flange" | "valve" | "psv" | "bolt_gasket" | "support" | "other",
      "description": string,
      "size_inch": string,
      "material": string | null,
      "quantity": number,
      "unit": "m" | "EA"
    }
  ],
  "ai_findings": [
    {
      "severity": "critical" | "warning" | "info",
      "category": "PSV" | "재질·탈지" | "방폭·이격" | "역류·차단" | "용접·NDT" | "인허가",
      "rule_ref": string,
      "title": string,
      "detail": string,
      "recommendation": string
    }
  ],
  "summary": string
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

    // Strictly master-only while in Private Plant AI Lab
    const adminClient = createClient(supabaseUrl, supabaseService);
    const { data: roleRows } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", userData.user.id)
      .eq("role", "master")
      .limit(1);
    if (!roleRows || roleRows.length === 0) {
      return json({ error: "Forbidden: master-only private lab" }, 403);
    }

    const body = await req.json();
    const fileName = String(body.fileName || "iso-drawing.pdf");
    const gasHint = typeof body.gasHint === "string" ? body.gasHint : undefined;
    const extractedTextHint = typeof body.extractedTextHint === "string" ? body.extractedTextHint : undefined;
    const images: Array<{ base64: string; mimeType?: string }> = Array.isArray(body.images)
      ? body.images.slice(0, MAX_IMAGES)
      : [];

    if (images.length === 0 && !extractedTextHint?.trim()) {
      return json({ error: "도면 이미지 또는 텍스트가 필요합니다." }, 400);
    }
    const totalChars = images.reduce((acc, img) => acc + String(img.base64 || "").length, 0);
    if (totalChars > MAX_TOTAL_BASE64_CHARS) {
      return json({ error: "이미지 용량이 너무 큽니다. 1~2페이지로 나누어 시도하세요." }, 413);
    }

    const apiKey = await resolveGeminiApiKey();
    if (!apiKey) return json({ error: "GEMINI_API_KEY가 설정되지 않았습니다." }, 500);
    const model = resolveGeminiVisionModel();

    const prompt = buildIsoPrompt({ fileName, gasHint, extractedTextHint });
    const parts: Array<Record<string, unknown>> = [{ text: prompt }];
    for (const img of images) {
      if (!img?.base64) continue;
      parts.push({
        inline_data: {
          mime_type: img.mimeType || "image/jpeg",
          data: img.base64,
        },
      });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);
    try {
      const resp = await fetch(geminiGenerateContentUrl(model), {
        method: "POST",
        headers: geminiRequestHeaders(apiKey),
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        return json({ error: `Gemini API 오류 (${resp.status})`, detail: errText.slice(0, 300) }, 502);
      }
      const raw = await resp.json();
      const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text || "";
      const cleaned = text.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned);
      return json({ ok: true, model, result: parsed });
    } finally {
      clearTimeout(timer);
    }
  } catch (err: any) {
    return json({ error: err?.message || "ISO 분석 중 오류가 발생했습니다." }, 500);
  }
});
