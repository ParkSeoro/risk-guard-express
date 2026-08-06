/**
 * Risk-assessment AI client (NVIDIA NIM).
 * DeepSeek V4 Flash/Pro hosted endpoints were deprecated on NIM (2026-08-07);
 * risk generation uses Nemotron Super by default, with ordered model failover
 * via nvidiaChat.ts (same API key, per-model free-tier limits).
 *
 * Filename/exports kept for import stability.
 *
 * Env:
 *   NVIDIA_API_KEY / DEEPSEEK_API_KEY
 *   NVIDIA_MODEL_CHAIN — optional comma-separated override
 *   NVIDIA_FAILOVER — default true
 *   RISK_AI_MODEL — legacy primary hint (peekPrimaryModelSync)
 *   DEEPSEEK_TIMEOUT_MS / NVIDIA_TIMEOUT_MS
 */
import {
  callNvidiaChat,
  streamNvidiaChatText,
  peekPrimaryModelSync,
  NvidiaChatError,
  type ChatMessage,
} from "./nvidiaChat.ts";

const DEFAULT_TIMEOUT_MS = 90_000;

export const RISK_DEEPSEEK_MODEL = peekPrimaryModelSync();

export class DeepseekRiskError extends Error {
  status: number;
  code:
    | "RATE_LIMIT"
    | "QUOTA_EXHAUSTED"
    | "INVALID_KEY"
    | "TIMEOUT"
    | "BAD_REQUEST"
    | "SERVER_ERROR"
    | "PARSE_ERROR";
  constructor(message: string, status: number, code: DeepseekRiskError["code"]) {
    super(message);
    this.name = "DeepseekRiskError";
    this.status = status;
    this.code = code;
  }
}

export type DeepseekRiskRequest = {
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  /** Abort after N ms (default DEEPSEEK_TIMEOUT_MS or 90000). */
  timeoutMs?: number;
  /** Override retry count per model (default via nvidiaChat). */
  maxAttempts?: number;
};

function wrapNvidiaError(e: unknown): never {
  if (e instanceof DeepseekRiskError) throw e;
  if (e instanceof NvidiaChatError) {
    const code =
      e.code === "MODEL_NOT_FOUND" || e.code === "DISABLED"
        ? "SERVER_ERROR"
        : (e.code as DeepseekRiskError["code"]);
    throw new DeepseekRiskError(e.message, e.status, code);
  }
  throw new DeepseekRiskError(
    e instanceof Error ? e.message : "NVIDIA 네트워크 오류",
    500,
    "SERVER_ERROR",
  );
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

/**
 * Non-streaming OpenAI-compatible chat completion → risk AI (model chain).
 */
export async function callDeepseekRiskChat(req: DeepseekRiskRequest): Promise<{
  content: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model?: string;
  fallbackFrom?: string;
}> {
  const timeoutRaw = Number(Deno.env.get("DEEPSEEK_TIMEOUT_MS") || DEFAULT_TIMEOUT_MS);
  const defaultTimeout = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS;
  try {
    const result = await callNvidiaChat({
      messages: req.messages,
      temperature: req.temperature,
      max_tokens: req.max_tokens,
      timeoutMs: req.timeoutMs ?? defaultTimeout,
      maxAttemptsPerModel: req.maxAttempts,
    });
    return {
      content: result.content,
      usage: result.usage,
      model: result.model,
      fallbackFrom: result.fallbackFrom,
    };
  } catch (e) {
    wrapNvidiaError(e);
  }
}

/**
 * Streaming chat completions — yields UTF-8 content deltas.
 * Failover only if the initial HTTP response fails (see nvidiaChat).
 */
export async function* streamDeepseekRiskChatText(
  req: DeepseekRiskRequest,
): AsyncGenerator<string, void, unknown> {
  const timeoutRaw = Number(Deno.env.get("DEEPSEEK_TIMEOUT_MS") || DEFAULT_TIMEOUT_MS);
  const defaultTimeout = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : DEFAULT_TIMEOUT_MS;
  try {
    yield* streamNvidiaChatText({
      messages: req.messages,
      temperature: req.temperature,
      max_tokens: req.max_tokens,
      timeoutMs: req.timeoutMs ?? defaultTimeout,
      maxAttemptsPerModel: req.maxAttempts,
    });
  } catch (e) {
    wrapNvidiaError(e);
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
