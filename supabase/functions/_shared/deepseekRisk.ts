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
/** One-shot abort. 5–7 dense rows should finish well under Edge worker limits. */
const DEFAULT_TIMEOUT_MS = 60_000;

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
        max_tokens: typeof req.max_tokens === "number" ? req.max_tokens : 4096,
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
        max_tokens: typeof req.max_tokens === "number" ? req.max_tokens : 4096,
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

/** Expert system prompt — risk assessment only (DeepSeek path). One-shot 5–7 fatal risks. */
export const RISK_DEEPSEEK_SYSTEM_PROMPT = `너는 대한민국 최고 권위의 건설안전 기술사이자 산업안전보건법 전문가이다.

산업안전보건기준에 관한 규칙 및 KOSHA GUIDE에 의거하여, 해당 공종에서 [사망, 중상, 화재, 폭발]로 직결되는 가장 치명적인 핵심 위험요인 5~7개만 엄선하여 작성하라. 과다 나열·망라형 생성 금지.

[STRICT OUTPUT RULES]
1. 추상 문구(예: "안전수칙 준수", "주의 작업") 금지. 구체 장비·자재·절차 명시.
2. 위험요인은 법적 기준/원인에 근거한 구체 발생 상황으로 기술.
3. 개선대책은 공학적·관리적·PPE를 모두 포함.
4. 마크다운 없이 순수 JSON만. 서문·후기 금지.
5. 문체: 개조식(명사형). 서술형(~할 것, ~합니다) 금지.
6. 치명 위험은 initial_likelihood/severity를 '상'으로.

[JSON SCHEMA — {"items":[...]} 정확히 5~7개]
각 item: process, sub_work, hazard_factor, hazard_situation, existing_control, improvement_control,
initial_likelihood, initial_severity, initial_risk_level,
residual_likelihood, residual_severity, residual_risk_level, ppe`;
