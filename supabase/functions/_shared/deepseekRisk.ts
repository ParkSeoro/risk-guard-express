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
  /** Override retry count (default 3). Use 1 for fast draft calls. */
  maxAttempts?: number;
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
  // NVIDIA NIM overload / capacity (often transient)
  if (status === 529 || status === 503) {
    throw new DeepseekRiskError(
      "AI 서버가 일시적으로 과부하입니다. 잠시 후 다시 시도해주세요.",
      status,
      "RATE_LIMIT",
    );
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

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 529;
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
 * NVIDIA NIM DeepSeek-V4 defaults to "thinking" mode, which streams
 * reasoning_content for tens of seconds before any JSON content.
 * That looks like a hung SSE (0 items) and then disconnects at ~90s.
 * Disable thinking so JSONL tokens start immediately.
 */
function deepseekChatBody(req: DeepseekRiskRequest, stream: boolean): Record<string, unknown> {
  return {
    model: DEEPSEEK_MODEL,
    messages: req.messages,
    temperature: typeof req.temperature === "number" ? req.temperature : stream ? 0.45 : 0.4,
    max_tokens: typeof req.max_tokens === "number" ? req.max_tokens : 6000,
    stream,
    chat_template_kwargs: { thinking: false },
  };
}

/** Extract assistant text delta from an OpenAI-compatible SSE chunk. */
function extractContentDelta(parsed: any): string {
  const choice = parsed?.choices?.[0];
  const delta = choice?.delta;
  if (typeof delta?.content === "string" && delta.content) return delta.content;
  // Some gateways put the final message on non-delta frames
  if (typeof choice?.message?.content === "string" && choice.message.content) {
    return choice.message.content;
  }
  return "";
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
  const maxAttempts = Math.max(1, Math.min(4, req.maxAttempts ?? 3));
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
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
        body: JSON.stringify(deepseekChatBody(req, false)),
      });

      if (!resp.ok) {
        const text = await resp.text();
        if (isRetryableStatus(resp.status) && attempt < maxAttempts) {
          console.warn(`[DeepSeek-Risk] retryable ${resp.status}, attempt ${attempt}/${maxAttempts}`);
          await new Promise((r) => setTimeout(r, 800 * attempt));
          continue;
        }
        mapHttpError(resp.status, text);
      }

      const data = await resp.json();
      const content = String(data?.choices?.[0]?.message?.content ?? "").trim();
      return { content, usage: data?.usage };
    } catch (e) {
      lastErr = e;
      if (e instanceof DeepseekRiskError) {
        if (e.code === "RATE_LIMIT" && attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 800 * attempt));
          continue;
        }
        throw e;
      }
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

  if (lastErr instanceof DeepseekRiskError) throw lastErr;
  throw new DeepseekRiskError("DeepSeek 요청 재시도 실패", 500, "SERVER_ERROR");
}

/**
 * Streaming chat completions — yields UTF-8 content deltas.
 * Used by generate-risk-ai SSE phases.
 */
export async function* streamDeepseekRiskChatText(
  req: DeepseekRiskRequest,
): AsyncGenerator<string, void, unknown> {
  const { apiKey, baseUrl, timeoutMs: defaultTimeout } = resolveConfig();
  // Wall clock for the whole completion. Idle abort is enforced separately below
  // so slow-but-progressing streams are not killed mid-JSONL.
  const timeoutMs = Math.max(req.timeoutMs ?? defaultTimeout, 120_000);
  const idleMs = Math.min(45_000, timeoutMs);
  const controller = new AbortController();
  let idleTimer = setTimeout(() => controller.abort(), idleMs);
  const bumpIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), idleMs);
  };
  const wallTimer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      },
      signal: controller.signal,
      body: JSON.stringify(deepseekChatBody(req, true)),
    });

    if (!resp.ok) {
      const text = await resp.text();
      mapHttpError(resp.status, text);
    }
    if (!resp.body) {
      throw new DeepseekRiskError("DeepSeek 스트림 응답이 비어 있습니다.", 500, "SERVER_ERROR");
    }

    bumpIdle();
    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8", { stream: true } as TextDecoderOptions);
    let carry = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bumpIdle();
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
          const delta = extractContentDelta(parsed);
          if (delta) yield delta;
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
    clearTimeout(idleTimer);
    clearTimeout(wallTimer);
  }
}

/** Expert system prompt — JSA risk assessment (DeepSeek). JSONL only. */
export const RISK_DEEPSEEK_SYSTEM_PROMPT = `너는 대한민국 최고 권위의 건설안전 기술사이다. 사용자가 입력한 공종에 대하여 최신 [산업안전보건법]에 의거한 작업안전분석(JSA) 위험성평가를 작성하라.
[규칙]
1. 시간 흐름(작업 전 준비 ➔ 본 작업 ➔ 마무리)에 따라 모든 절차를 누락 없이 도출할 것.
2. 추상적 문구 절대 금지. 구체적 장비명과 재해 메커니즘을 명시할 것.
3. 개선대책은 공학적, 관리적, 개인보호구(PPE)를 모두 포함할 것.
4. 마크다운(\`\`\`json 등) 없이 출력할 것.
[출력 형식 — JSON Lines 필수]
절대 JSON Array([ ])로 묶지 마라. 쉼표(,)로 객체를 구분하지도 마라.
반드시 각 단위 작업별로 한 줄에 하나의 순수 JSON 객체만 출력하는 JSON Lines(JSONL) 형식으로 출력하라.
예시:
{"process":"공종","sub_work":"준비","hazard_factor":"...","hazard_situation":"...","existing_control":"...","improvement_control":"...","initial_likelihood":"상","initial_severity":"상","initial_risk_level":"상","residual_likelihood":"중","residual_severity":"중","residual_risk_level":"중","ppe":"안전모, 안전대"}
{"process":"공종","sub_work":"본작업","hazard_factor":"...","hazard_situation":"...","existing_control":"...","improvement_control":"...","initial_likelihood":"상","initial_severity":"상","initial_risk_level":"상","residual_likelihood":"중","residual_severity":"중","residual_risk_level":"중","ppe":"안전모, 안전화"}
[JSON 키 포맷]
process, sub_work, hazard_factor, hazard_situation, existing_control, improvement_control, initial_likelihood, initial_severity, initial_risk_level, residual_likelihood, residual_severity, residual_risk_level, ppe`;
