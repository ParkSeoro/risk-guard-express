import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { digestFromSource, omittedCompanies, type WeeklySource } from "../_shared/weeklyReportGuard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-push-trigger-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const REPORT_PROMPT = `당신은 건설현장 주간 안전보고를 적습니다.
입력은 지난 한 주 허가서를 회사별로 모은 작업 목록입니다.
작업은 빠뜨리지 마세요. 회사 머리글은 입력에 있는 그 회사 이름을 괄호로 감싸 적으세요. 괄호 안에 회사명이라고 적지 마세요. 회사를 빼거나 다른 회사 아래로 합치지 마세요. 같은 회사 안에서 이미 합쳐진 줄은 다시 나누지 마세요. 장소도 빼지 마세요.
제목과 같은 작업 줄은 다시 만들지 마세요.
각 작업 줄 바로 아래에 위험과 대책을 붙이되, 그 작업에서 실제로 큰 위험만 적으세요.
위험이 크지 않은 작업은 작업 내용만 남기세요. 위험과 대책 줄을 만들지 마세요.
위험 줄에는 재해 이름만 적지 마세요. 어떤 요인이 어떤 위험으로 이어지는지 적으세요.
예: - 위험: 고소작업에 의한 추락
예: - 위험: 용접 불티에 의한 화재
예: - 위험: 중량물 인양에 의한 낙하
"- 위험: 추락"처럼 요인이나 재해 이름만 있는 줄은 쓰지 마세요.
작업에 없는 장비나 공종을 만들지 마세요. 대책은 그 위험을 막는 짧은 조치 한 줄입니다.
형식만 반환하세요. 설명과 주간 안전관리 실적은 적지 마세요.

[현장명 현장 주간 안전보고]

(입력된 회사 이름)
■ 작업 구역
* 그 주에 한 작업
- 위험: 요인에 의한 위험
- 대책: 한 줄`;

type ReportRow = {
  id: string;
  project_id: string;
  week_start: string;
  body: string;
  source: unknown;
  source_hash: string | null;
  status: string | null;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function geminiKey(): Promise<string> {
  const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const service = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  const fromEnv = (Deno.env.get("GEMINI_API_KEY") || "").trim();
  if (!url || !service) return fromEnv;
  try {
    const resp = await fetch(`${url}/rest/v1/rpc/get_runtime_secret`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: service,
        Authorization: `Bearer ${service}`,
      },
      body: JSON.stringify({ secret_name: "GEMINI_API_KEY" }),
    });
    if (!resp.ok) return fromEnv;
    const data = await resp.json().catch(() => null);
    const fromVault = typeof data === "string" ? data.trim() : "";
    return fromVault || fromEnv;
  } catch {
    return fromEnv;
  }
}

function seoulToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function weekStartMonday(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  const shift = weekday === 0 ? -6 : 1 - weekday;
  date.setUTCDate(date.getUTCDate() + shift);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function compactLabel(value: string): string {
  return value.toLowerCase().replace(/[^0-9a-zA-Z가-힣]+/g, "");
}

function stripRepeatedHeadings(text: string): string {
  let heading = "";
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const asHeading = trimmed.match(/^■\s*(.*)$/);
    if (asHeading) {
      heading = compactLabel(asHeading[1]);
      kept.push(line);
      continue;
    }
    const asBullet = trimmed.match(/^\*\s*(.*)$/);
    if (asBullet && heading && compactLabel(asBullet[1]) === heading) continue;
    kept.push(line);
  }
  return kept
    .join("\n")
    .replace(/^\((?:회사명|회사 이름|입력된 회사 이름|실제 회사 이름)\)\s*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function factorOnlyRisk(text: string): boolean {
  return text.split("\n").some((line) =>
    /^-\s*위험:\s*(추락|낙하|화재|감전|붕괴|협착|끼임|유증기|전도|질식)\s*$/.test(line.trim())
  );
}

async function askGemini(apiKey: string, source: unknown, extra: string): Promise<string> {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: REPORT_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(source) + extra }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 32768,
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    },
  );
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String(payload?.error?.message || "주간 보고를 만들지 못했습니다.").slice(0, 180));
  }
  const candidate = payload?.candidates?.[0] || {};
  if (candidate.finishReason === "MAX_TOKENS") {
    throw new Error("보고가 길이를 넘겼습니다.");
  }
  const parts = candidate?.content?.parts || [];
  return parts.map((part: { text?: string }) => part.text || "").join("\n").trim();
}

function companyBlock(source: unknown, name: string): string {
  const digest = digestFromSource(source);
  const at = digest.indexOf(`(${name})`);
  return (at >= 0 ? digest.slice(at) : digest).trim();
}

function hasRiskLine(text: string): boolean {
  return text.split("\n").some((line) => line.trim().startsWith("- 위험:"));
}

function withCompanyHeader(text: string, name: string): string {
  const trimmed = text.trim();
  const at = trimmed.indexOf(`(${name})`);
  if (at >= 0) return trimmed.slice(at).trim();
  if (!trimmed.includes("■")) return "";
  return `(${name})\n${trimmed}`;
}

async function writeCompany(apiKey: string, source: WeeklySource, company: NonNullable<WeeklySource["companies"]>[number]): Promise<string> {
  const name = String(company?.name || "").trim() || "업체 미지정";
  const slice: WeeklySource = { project_name: source.project_name, companies: [company] };
  const fallback = companyBlock(slice, name);
  let text = "";
  try {
    text = await askGemini(apiKey, slice, "");
    if (factorOnlyRisk(text) || (text.includes("■") && !hasRiskLine(text))) {
      text = await askGemini(
        apiKey,
        slice,
        "\n각 작업 줄 바로 아래에 '- 위험: 요인에 의한 위험'과 '- 대책: 한 줄'을 붙이세요. 회사를 빼지 마세요.",
      );
    }
  } catch {
    return fallback;
  }
  if (factorOnlyRisk(text)) return fallback;
  const headed = withCompanyHeader(text, name);
  if (!headed || !hasRiskLine(headed)) return fallback;
  return headed;
}

async function writeRisks(apiKey: string, source: unknown): Promise<string> {
  const src = (source || {}) as WeeklySource;
  const project = String(src.project_name || "").trim() || "현장";
  const companies = src.companies || [];
  const blocks: string[] = [];
  for (const company of companies) {
    blocks.push(await writeCompany(apiKey, src, company));
  }
  const text = [`[${project} 현장 주간 안전보고]`, ...blocks].join("\n\n").trim();
  const missing = omittedCompanies(source, text);
  if (missing.length > 0) {
    throw new Error(`빠진 업체가 있습니다: ${missing.slice(0, 4).join(", ")}`);
  }
  return text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!supabaseUrl || !serviceKey) return jsonResponse({ error: "서버 설정이 없습니다." }, 500);

  const body = await req.json().catch(() => ({}));
  const requestedDay = typeof body.week_start === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.week_start)
    ? body.week_start
    : seoulToday();
  const requestedWeek = weekStartMonday(requestedDay);
  const projectId = typeof body.project_id === "string" ? body.project_id : "";

  const authHeader = req.headers.get("Authorization") || "";
  const triggerHeader = req.headers.get("X-Push-Trigger-Secret") || "";
  const triggerSecret = Deno.env.get("PUSH_TRIGGER_SECRET") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const serviceCall = bearer === serviceKey || (!!triggerSecret && triggerHeader === triggerSecret);

  const service = createClient(supabaseUrl, serviceKey);
  if (!serviceCall) {
    if (!authHeader || !anonKey) return jsonResponse({ error: "로그인이 필요합니다." }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return jsonResponse({ error: "로그인이 필요합니다." }, 401);
    const { data: allowed, error: accessError } = await userClient.rpc("can_manage_owner_safety", {
      _user_id: authData.user.id,
    });
    if (accessError || allowed !== true) return jsonResponse({ error: "건설안전팀만 주간 보고를 만들 수 있습니다." }, 403);
    if (!projectId) return jsonResponse({ error: "현장을 선택해 주세요." }, 400);
  }

  const { error: registerError } = await service.rpc("register_owner_weekly_work_reports", {
    p_as_of: requestedWeek,
  });
  if (registerError) return jsonResponse({ error: registerError.message }, 500);

  let query = service
    .from("owner_weekly_work_reports")
    .select("id, project_id, week_start, body, source, source_hash, status")
    .eq("week_start", requestedWeek);
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  if (error) return jsonResponse({ error: error.message }, 500);

  const rows = (data || []) as ReportRow[];
  if (rows.length === 0) {
    return jsonResponse({
      ok: true,
      skipped: true,
      message: "이번 주 발행된 작업이 없습니다.",
      written: 0,
    });
  }
  const pending = rows.filter((row) => row.status !== "ready" || omittedCompanies(row.source, row.body).length > 0);
  if (pending.length === 0) {
    return jsonResponse({
      ok: true,
      skipped: true,
      message: "작업 내용이 그대로입니다.",
      written: 0,
    });
  }

  const apiKey = await geminiKey();
  if (!apiKey) {
    return jsonResponse({
      ok: true,
      skipped: false,
      message: "작업 목록은 저장되어 있습니다. 위험과 대책은 아직 만들지 못했습니다.",
      written: 0,
    });
  }

  let written = 0;
  const failures: string[] = [];
  for (const row of pending) {
    try {
      const text = stripRepeatedHeadings(await writeRisks(apiKey, row.source));
      if (!text || !text.includes("■") || !hasRiskLine(text)) {
        throw new Error("위험과 대책이 없습니다.");
      }
      const { error: updateError } = await service
        .from("owner_weekly_work_reports")
        .update({ body: text, status: "ready", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (updateError) throw new Error(updateError.message);
      written += 1;
    } catch (err) {
      failures.push(err instanceof Error ? err.message : "작성 실패");
      const missing = omittedCompanies(row.source, row.body);
      await service
        .from("owner_weekly_work_reports")
        .update({
          ...(missing.length > 0 ? { body: digestFromSource(row.source) } : {}),
          status: "digest",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
    }
  }

  return jsonResponse({
    ok: failures.length === 0,
    skipped: false,
    written,
    failed: failures.length,
    message: failures[0] || "",
  });
});
