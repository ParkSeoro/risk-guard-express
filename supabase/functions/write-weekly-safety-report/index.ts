import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  companyNames,
  digestFromSource,
  everyWorkPaired,
  normalizeCompanySource,
  omittedCompanies,
  type WeeklySource,
} from "../_shared/weeklyReportGuard.ts";

const REPORT_PROMPT = `당신은 건설현장 주간 안전보고를 적습니다.
입력은 지난 한 주 허가서를 회사별로 모은 작업 목록입니다. 각 묶음에 hazards가 있습니다.
1. 회사는 빼지 마세요. 회사 머리글은 입력에 있는 그 회사 이름을 괄호로 감싸 적으세요. 회사를 다른 회사 아래로 합치지 마세요.
2. 같은 공종인데 철자/오타(예: PROJET/PROJECT)나 공백만 다른 중복 구역(■)은 하나의 깔끔한 ■ 공종 제목으로 합치세요. 구역 제목에 세부 작업이 길게 붙어 있으면 핵심 공종명 위주로 간결히 정리하세요.
3. 유사하거나 중복되는 작업(예: 자재 인양·자재 하역·기계 하역 → 자재 인양 및 하역, 같은 건물/공종의 유사 작업 등)은 공종·장소 맥락에 맞게 하나의 * 작업 줄로 통합하되, 실제 작업 내용은 빠뜨리지 마세요. 번호 잔재("9 ."), 의미 없는 단일 단어("설치"), 명백한 오타("사부동"→"사무동", "먹메김"→"먹매김")는 자연스럽게 정돈하세요.
4. 입력에 없는 "* 나머지 작업" 같은 가상의 줄을 새로 만들지 마세요.
5. 모든 ■ 구역 아래에는 반드시 최소 1개 이상의 * 작업 줄을 두고, 모든 * 작업 줄 바로 아래에는 "- 위험: ..."과 "- 대책: ..."을 한 쌍(또는 필요 시 2쌍 이내)으로 적으세요.
6. 위험·대책은 모든 작업에 "고소작업에 의한 추락 / 안전방망 설치"를 기계적으로 반복하지 말고, 각 작업의 실제 공종(기밀시험 압력·누설, 치핑 비산, 도장 유증기, 굴착 사면 붕괴·장비 협착, 양중 낙하·신호수, 전기 LOTO·검전·ELB, 용접 불티방지포·화재감시자 등)에 맞는 구체적이고 실무적인 위험과 대책을 적으세요.
7. 위험 줄에는 재해 이름만 적지 마세요. 어떤 요인이 어떤 위험으로 이어지는지 적으세요.
예: - 위험: 고소작업에 의한 추락
예: - 위험: 용접 불티에 의한 화재
예: - 위험: 중량물 인양에 의한 낙하
"- 위험: 추락"처럼 요인이나 재해 이름만 있는 줄은 쓰지 마세요.
8. 작업에 없는 장비나 공종을 지어내지 마세요. 형식만 반환하고 설명과 주간 안전관리 실적은 적지 마세요.

[현장명 현장 주간 안전보고]

(입력된 회사 이름)
■ 공종명
* 통합·정리된 작업 내용
- 위험: 그 작업의 구체적 요인에 의한 위험
- 대책: 그 위험을 막는 구체적 현장 조치`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-push-trigger-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

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

function echoLabels(source: unknown): Set<string> {
  const src = (source || {}) as WeeklySource;
  const project = String(src.project_name || "").trim();
  const labels = new Set<string>(companyNames(source));
  if (project) {
    labels.add(project);
    labels.add(`${project} 현장 주간 안전보고`);
  }
  return labels;
}

function stripRepeatedHeadings(text: string, source?: unknown): string {
  const echoes = echoLabels(source);
  const kept: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (echoes.has(trimmed)) continue;
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

function withCompanyHeader(text: string, name: string): string {
  const trimmed = text.trim();
  const at = trimmed.indexOf(`(${name})`);
  if (at >= 0) return trimmed.slice(at).trim();
  if (!trimmed.includes("■")) return "";
  return `(${name})\n${trimmed}`;
}

type CompanyWriteResult = {
  name: string;
  text: string;
  paired: boolean;
  error?: string;
};

async function writeCompany(
  apiKey: string,
  source: WeeklySource,
  company: NonNullable<WeeklySource["companies"]>[number],
): Promise<CompanyWriteResult> {
  const name = String(company?.name || "").trim() || "업체 미지정";
  const normalized = normalizeCompanySource(company);
  const slice: WeeklySource = { project_name: source.project_name, companies: [normalized] };
  const fallback = companyBlock(slice, name);

  let text = "";
  try {
    text = stripRepeatedHeadings(await askGemini(apiKey, slice, ""), slice);
    const headedFirst = withCompanyHeader(text, name);
    if (factorOnlyRisk(text) || !headedFirst || !everyWorkPaired(headedFirst)) {
      text = stripRepeatedHeadings(
        await askGemini(
          apiKey,
          slice,
          "\n모든 작업 줄(* ...) 바로 아래에 '- 위험: 요인에 의한 위험'과 '- 대책: 조치' 두 줄을 반드시 적으세요. 위험 줄에 재해 이름만 적지 마세요. 작업을 지우지 마세요. 회사를 빼지 마세요.",
        ),
        slice,
      );
    }
  } catch (err) {
    return {
      name,
      text: fallback,
      paired: false,
      error: err instanceof Error ? err.message : "AI 호출 실패",
    };
  }

  if (factorOnlyRisk(text)) {
    return { name, text: fallback, paired: false, error: "위험 줄에 요인만 있습니다." };
  }
  const headed = withCompanyHeader(text, name);
  if (!headed || !everyWorkPaired(headed)) {
    return { name, text: fallback, paired: false, error: "위험과 대책 짝이 누락되었습니다." };
  }
  return { name, text: headed, paired: true };
}

async function writeRisks(apiKey: string, source: unknown): Promise<{ text: string; partialWarning?: string }> {
  const src = (source || {}) as WeeklySource;
  const project = String(src.project_name || "").trim() || "현장";
  const companies = src.companies || [];
  if (companies.length === 0) {
    throw new Error("집계된 업체 작업이 없습니다.");
  }

  const results = await Promise.all(companies.map((company) => writeCompany(apiKey, src, company)));
  const pairedCount = results.filter((item) => item.paired).length;
  const failed = results.filter((item) => !item.paired);

  if (pairedCount === 0) {
    throw new Error(failed[0]?.error || "위험과 대책이 없는 작업이 있습니다.");
  }

  const text = [`[${project} 현장 주간 안전보고]`, ...results.map((item) => item.text)].join("\n\n").trim();
  const missing = omittedCompanies(source, text);
  if (missing.length > 0) {
    throw new Error(`빠진 업체가 있습니다: ${missing.slice(0, 4).join(", ")}`);
  }

  const partialWarning = failed.length > 0
    ? `일부 업체(${failed.map((f) => f.name).join(", ")})는 작업 목록만 유지되었습니다.`
    : undefined;
  return { text, partialWarning };
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
  const force = body.force === true && Boolean(projectId);

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
  const pending = force
    ? rows
    : rows.filter((row) => row.status !== "ready" || omittedCompanies(row.source, row.body).length > 0);
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
      ok: false,
      skipped: false,
      message: "작업 목록은 저장되어 있습니다. GEMINI_API_KEY가 없어 위험과 대책을 만들지 못했습니다.",
      written: 0,
      failed: pending.length,
    });
  }

  let written = 0;
  const failures: string[] = [];
  const warnings: string[] = [];
  for (const row of pending) {
    try {
      const { text: rawText, partialWarning } = await writeRisks(apiKey, row.source);
      const text = stripRepeatedHeadings(rawText, row.source);
      if (!text || !text.includes("■")) {
        throw new Error("보고 형식이 비어 있습니다.");
      }
      const { error: updateError } = await service
        .from("owner_weekly_work_reports")
        .update({ body: text, status: "ready", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      if (updateError) throw new Error(updateError.message);
      written += 1;
      if (partialWarning) warnings.push(partialWarning);
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
    message: failures[0] || warnings[0] || "",
  });
});
