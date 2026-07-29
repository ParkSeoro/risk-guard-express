/**
 * Risk-assessment-only DeepSeek V4 Flash client (NVIDIA NIM).
 * Completely separate from the generic Nemotron adapter in gemini.ts.
 *
 * Env (Supabase Edge Secrets / local Deno env):
 *   DEEPSEEK_API_KEY   — NVIDIA NIM API key (nvapi-...)
 *   DEEPSEEK_BASE_URL  — default https://integrate.api.nvidia.com/v1
 *   DEEPSEEK_TIMEOUT_MS — request abort timeout (default 90000; 3s is too short for multi-row gen)
 */
const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEEPSEEK_MODEL = "deepseek-ai/deepseek-v4-flash";
/** One-shot JSA abort — full prep→main→finish coverage needs longer than fatal-only. */
const DEFAULT_TIMEOUT_MS = 90_000;

export const RISK_DEEPSEEK_MODEL = DEEPSEEK_MODEL;

export class DeepseekRiskError extends Error {
  status: number;
  code: "RATE_LIMIT" | "QUOTA_EXHAUSTED" | "INVALID_KEY" | "TIMEOUT" | "BAD_REQUEST" | "SERVER_ERROR" | "PARSE_ERROR";
  constructor(message: string, status: number, code: DeepseekRiskError["code"]) {
    super(message);
    this.name = "DeepseekRiskError";
    this.status = status;
    this.code = code;
  }
}

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type DeepseekRiskRequest = {
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  /** Abort after N ms (default DEEPSEEK_TIMEOUT_MS or 90000). */
  timeoutMs?: number;
};

function resolveConfig(): { apiKey: string; baseUrl: string; timeoutMs: number } {
  const apiKey = Deno.env.get("DEEPSEEK_API_KEY") || Deno.env.get("NVIDIA_API_KEY") || "";
  if (!apiKey) {
    throw new DeepseekRiskError(
      "DEEPSEEK_API_KEY가 설정되지 않았습니다. Supabase Edge Secrets에 등록해야 합니다.",
      500,
      "INVALID_KEY",
    );
  }
  const baseUrl = (Deno.env.get("DEEPSEEK_BASE_URL") || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const timeoutRaw = Number(Deno.env.get("DEEPSEEK_TIMEOUT_MS") || DEFAULT_TIMEOUT_MS);
  const timeoutMs = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS;
  return { apiKey, baseUrl, timeoutMs };
}

function mapHttpError(status: number, text: string): never {
  console.error(`[DeepSeek-Risk] ${status}:`, text.slice(0, 500));
  if (status === 429) {
    throw new DeepseekRiskError("요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", 429, "RATE_LIMIT");
  }
  if (status === 401 || status === 403) {
    if (/quota|exceed|exhausted|credit/i.test(text)) {
      throw new DeepseekRiskError("NVIDIA API 할당량이 소진되었습니다. 사용량을 확인해주세요.", 402, "QUOTA_EXHAUSTED");
    }
    throw new DeepseekRiskError("DeepSeek API 키가 유효하지 않습니다. DEEPSEEK_API_KEY를 확인해주세요.", 403, "INVALID_KEY");
  }
  if (status === 400) {
    throw new DeepseekRiskError(`DeepSeek 요청 오류: ${text.slice(0, 200)}`, 400, "BAD_REQUEST");
  }
  throw new DeepseekRiskError(`DeepSeek 서버 오류 (${status})`, status, "SERVER_ERROR");
}

/** Strip ```json fences and extract first JSON value. */
export function stripCodeFences(raw: string): string {
  return (raw || "").replace(/```json/gi, "").replace(/```/g, "").trim();
}

/**
 * Safe JSON parse for DeepSeek risk responses (array or {items:[...]}).
 * Throws DeepseekRiskError(PARSE_ERROR) on failure.
 */
export function parseDeepseekRiskJson<T = unknown>(raw: string): T {
  let text = stripCodeFences(raw);
  if (!text) {
    throw new DeepseekRiskError("DeepSeek 응답이 비어 있습니다.", 500, "PARSE_ERROR");
  }
  if (!/^[\[{]/.test(text)) {
    const match = text.match(/[\[{][\s\S]*[\]}]/);
    if (match) text = match[0];
  }
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new DeepseekRiskError(`DeepSeek JSON 파싱 실패: ${msg}`, 500, "PARSE_ERROR");
  }
}

/**
 * Parse DeepSeek risk output into an item array.
 * On any parse failure: log and return [] (never throw) so Edge callers stay stable.
 */
export function safeParseDeepseekRiskItems(raw: string): any[] {
  try {
    const parsed = parseDeepseekRiskJson<any>(raw);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
    console.warn(
      "[DeepSeek-Risk] JSON parsed but no array/items found:",
      typeof parsed,
      String(raw).slice(0, 200),
    );
    return [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[DeepSeek-Risk] JSON parse failed → []:", msg, String(raw).slice(0, 400));
    // Second chance: extract first [...] or {...} substring
    try {
      const m = String(raw || "").match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      if (m) {
        const retry = JSON.parse(stripCodeFences(m[0]));
        if (Array.isArray(retry)) return retry;
        if (retry && Array.isArray(retry.items)) return retry.items;
      }
    } catch (e2) {
      console.error(
        "[DeepSeek-Risk] JSON retry parse failed → []:",
        e2 instanceof Error ? e2.message : String(e2),
      );
    }
    return [];
  }
}

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer),
  };
}

/**
 * Non-streaming OpenAI-compatible chat completion → DeepSeek V4 Flash.
 * model is hard-fixed to deepseek-ai/deepseek-v4-flash.
 */
export async function callDeepseekRiskChat(req: DeepseekRiskRequest): Promise<{
  content: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}> {
  const { apiKey, baseUrl, timeoutMs: defaultTimeout } = resolveConfig();
  const timeoutMs = req.timeoutMs ?? defaultTimeout;
  const { signal, clear } = withTimeoutSignal(timeoutMs);

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal,
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: req.messages,
        temperature: typeof req.temperature === "number" ? req.temperature : 0.4,
        max_tokens: typeof req.max_tokens === "number" ? req.max_tokens : 6000,
        stream: false,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      mapHttpError(resp.status, text);
    }

    const data = await resp.json();
    const content = String(data?.choices?.[0]?.message?.content ?? "").trim();
    return { content, usage: data?.usage };
  } catch (e) {
    if (e instanceof DeepseekRiskError) throw e;
    if ((e as Error)?.name === "AbortError") {
      throw new DeepseekRiskError(
        `DeepSeek 요청이 ${timeoutMs}ms 내 완료되지 않아 중단되었습니다.`,
        504,
        "TIMEOUT",
      );
    }
    throw new DeepseekRiskError(
      e instanceof Error ? e.message : "DeepSeek 네트워크 오류",
      500,
      "SERVER_ERROR",
    );
  } finally {
    clear();
  }
}

/**
 * Streaming chat completions — yields UTF-8 content deltas.
 * Used by generate-risk-ai SSE phases.
 */
export async function* streamDeepseekRiskChatText(
  req: DeepseekRiskRequest,
): AsyncGenerator<string, void, unknown> {
  const { apiKey, baseUrl, timeoutMs: defaultTimeout } = resolveConfig();
  const timeoutMs = req.timeoutMs ?? defaultTimeout;
  const { signal, clear } = withTimeoutSignal(timeoutMs);

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      signal,
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        messages: req.messages,
        temperature: typeof req.temperature === "number" ? req.temperature : 0.45,
        max_tokens: typeof req.max_tokens === "number" ? req.max_tokens : 6000,
        stream: true,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text();
      mapHttpError(resp.status, text);
    }
    if (!resp.body) {
      throw new DeepseekRiskError("DeepSeek 스트림 응답이 비어 있습니다.", 500, "SERVER_ERROR");
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8", { stream: true } as TextDecoderOptions);
    let carry = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      carry += decoder.decode(value, { stream: true });
      const lines = carry.split("\n");
      carry = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta) yield delta;
        } catch {
          /* ignore partial SSE JSON */
        }
      }
    }
  } catch (e) {
    if (e instanceof DeepseekRiskError) throw e;
    if ((e as Error)?.name === "AbortError") {
      throw new DeepseekRiskError(
        `DeepSeek 스트림이 ${timeoutMs}ms 내 완료되지 않아 중단되었습니다.`,
        504,
        "TIMEOUT",
      );
    }
    throw new DeepseekRiskError(
      e instanceof Error ? e.message : "DeepSeek 스트림 네트워크 오류",
      500,
      "SERVER_ERROR",
    );
  } finally {
    clear();
  }
}

/** Expert system prompt — JSA-based full-process risk assessment (DeepSeek path). */
export const RISK_DEEPSEEK_SYSTEM_PROMPT = `너는 대한민국 최고 권위의 건설안전 기술사이자 산업안전보건법 전문가이다. 
사용자가 입력한 공종 및 세부 작업에 대하여, 최신 개정된 [산업안전보건법] 및 [KOSHA GUIDE]에 의거하여 현장에 즉시 적용 가능한 '작업안전분석(JSA)' 기반의 완벽한 위험성평가 데이터를 생성하라.

[STRICT OUTPUT RULES: 필수 준수 규칙]
1. [전 공정 분해 (JSA 방식)]: 공종을 분석하여 시간 흐름에 따라 **①작업 전 준비 및 장비 반입 ➔ ②본 작업(단위 작업별로 세분화) ➔ ③작업 후 정리 및 해체**까지 모든 작업 절차를 단 하나도 누락 없이 도출할 것.
2. [법적/구체적 기술]: "안전수칙 준수" 같은 추상적 문구 절대 금지. [산업안전보건기준에 관한 규칙] 조항에 근거한 구체적인 장비명, 자재명, 발생 가능한 재해(추락, 낙하, 붕괴, 화재, 감전 등) 메커니즘을 상세히 명시할 것.
3. [근본적 개선대책]: 대책은 반드시 '공학적 대책(설비/방호장치/인터록)', '관리적 대책(허가서/신호수/교육)', '개인보호구(PPE)'를 종합적으로 서술할 것.
4. [형식 엄수]: 마크다운(\`\`\`json 등)이나 불필요한 서론/결론을 일절 제외하고 오직 순수한 JSON Array [ {...}, {...} ] 형태로만 출력할 것.

[JSON SCHEMA FORMAT]
[
  {
    "process": "공종명 (예: 철골 작업)",
    "sub_work": "시간순 세부작업 (예: 1. 작업 전 자재 양중 및 줄걸이 점검)",
    "hazard_factor": "구체적 위험요인 (기인물+결함)",
    "hazard_situation": "위험발생상황 시나리오 (법적 위반 사항 포함)",
    "existing_control": "기존 대책",
    "improvement_control": "법적/공학적 개선 대책",
    "initial_likelihood": "상", "initial_severity": "상", "initial_risk_level": "상",
    "residual_likelihood": "중", "residual_severity": "중", "residual_risk_level": "중",
    "ppe": "안전모, 안전대"
  }
]`;
