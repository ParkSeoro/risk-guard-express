/**
 * Shared NVIDIA NIM chat client with ordered model failover.
 *
 * Same API key (NVIDIA_API_KEY). Different model IDs for per-model free-tier limits.
 * Primary default stays nvidia/llama-3.3-nemotron-super-49b-v1.5 (risk AI tuned).
 *
 * Failover triggers: 429 / 503 / 529 / QUOTA / TIMEOUT / model-not-found.
 * Does NOT failover on prompt/parse/400 (except missing model).
 *
 * Chain sources (priority):
 * 1) per-call `models` override (e.g. fast draft chain)
 * 2) ai_runtime_settings.model_chain (DB, cached ~60s)
 * 3) NVIDIA_MODEL_CHAIN env (comma-separated)
 * 4) built-in DEFAULT_MODEL_CHAIN
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
export const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

/** Current production primary — do not change lightly (risk AI calibrated). */
export const DEFAULT_PRIMARY_MODEL = "nvidia/llama-3.3-nemotron-super-49b-v1.5";

export const DEFAULT_MODEL_CHAIN: string[] = [
  DEFAULT_PRIMARY_MODEL,
  "meta/llama-3.3-70b-instruct",
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "mistralai/mistral-small-3.1-24b-instruct-2503",
];

/**
 * Fast chain for risk scope_draft (세부작업·위험요인 초안).
 * DeepSeek V4 Flash was retired on NIM — use a smaller instruct model first,
 * then larger models only if the fast primary fails/times out.
 */
export const DEFAULT_DRAFT_MODEL = "mistralai/mistral-small-3.1-24b-instruct-2503";

export const DEFAULT_DRAFT_MODEL_CHAIN: string[] = [
  DEFAULT_DRAFT_MODEL,
  "meta/llama-3.3-70b-instruct",
  DEFAULT_PRIMARY_MODEL,
];

/** Resolve draft model chain (env override → built-in fast chain). */
export function resolveDraftModelChain(): string[] {
  const chainRaw = Deno.env.get("RISK_AI_DRAFT_MODEL_CHAIN")?.trim();
  if (chainRaw) {
    const list = chainRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length) return list;
  }
  const primary =
    Deno.env.get("RISK_AI_DRAFT_MODEL")?.trim() || DEFAULT_DRAFT_MODEL;
  const rest = DEFAULT_DRAFT_MODEL_CHAIN.filter((m) => m !== primary);
  return [primary, ...rest];
}

export type NvidiaErrorCode =
  | "RATE_LIMIT"
  | "QUOTA_EXHAUSTED"
  | "INVALID_KEY"
  | "TIMEOUT"
  | "BAD_REQUEST"
  | "SERVER_ERROR"
  | "MODEL_NOT_FOUND"
  | "DISABLED"
  | "CALL_CAP";

/**
 * Hard ceiling on NVIDIA HTTP calls inside one callNvidiaChat (model × retry).
 * Without this: DEFAULT_MODEL_CHAIN(4) × maxAttemptsPerModel(2) = 8 per edge request;
 * × client withRetry(3) ≈ 24 LLM calls per risk row.
 * Cap 6: primary 2 attempts + up to 2 failover models × 2 — enough failover, cuts runaway.
 * Override: env NVIDIA_MAX_LLM_CALLS_PER_REQUEST (1–16).
 */
export const DEFAULT_MAX_LLM_CALLS_PER_REQUEST = 6;

export function resolveMaxLlmCallsPerRequest(): number {
  const raw = Number(Deno.env.get("NVIDIA_MAX_LLM_CALLS_PER_REQUEST") || "");
  if (Number.isFinite(raw) && raw >= 1) return Math.min(16, Math.floor(raw));
  return DEFAULT_MAX_LLM_CALLS_PER_REQUEST;
}

export class NvidiaChatError extends Error {
  status: number;
  code: NvidiaErrorCode;
  model?: string;
  constructor(message: string, status: number, code: NvidiaErrorCode, model?: string) {
    super(message);
    this.name = "NvidiaChatError";
    this.status = status;
    this.code = code;
    this.model = model;
  }
}

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type RuntimeSettings = {
  isEnabled: boolean;
  failoverEnabled: boolean;
  models: string[];
};

type CacheEntry = { at: number; value: RuntimeSettings };
let settingsCache: CacheEntry | null = null;
const CACHE_MS = 60_000;

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = Deno.env.get(name);
  if (raw == null || raw === "") return defaultValue;
  return !/^(0|false|no|off)$/i.test(raw.trim());
}

function parseEnvChain(): string[] | null {
  const raw = Deno.env.get("NVIDIA_MODEL_CHAIN")?.trim();
  if (!raw) return null;
  const list = raw.split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : null;
}

/** Built-in chain; RISK_AI_MODEL / NVIDIA_MODEL can pin primary without dropping fallbacks. */
function builtInChain(): string[] {
  const primary =
    Deno.env.get("RISK_AI_MODEL")?.trim() ||
    Deno.env.get("NVIDIA_MODEL")?.trim() ||
    DEFAULT_PRIMARY_MODEL;
  const rest = DEFAULT_MODEL_CHAIN.filter((m) => m !== primary);
  return [primary, ...rest];
}

function normalizeModels(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const id = typeof item === "string"
      ? item.trim()
      : item && typeof item === "object" && typeof (item as any).id === "string"
      ? String((item as any).id).trim()
      : "";
    const enabled = typeof item === "object" && item
      ? (item as any).enabled !== false
      : true;
    if (!id || !enabled || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

async function loadRuntimeSettings(): Promise<RuntimeSettings> {
  const now = Date.now();
  if (settingsCache && now - settingsCache.at < CACHE_MS) {
    return settingsCache.value;
  }

  const fallback: RuntimeSettings = {
    isEnabled: envFlag("NVIDIA_AI_ENABLED", true),
    failoverEnabled: envFlag("NVIDIA_FAILOVER", true),
    models: parseEnvChain() || builtInChain(),
  };

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      settingsCache = { at: now, value: fallback };
      return fallback;
    }
    const sb = createClient(url, key);
    const { data, error } = await sb
      .from("ai_runtime_settings")
      .select("is_enabled, failover_enabled, model_chain")
      .eq("id", 1)
      .maybeSingle();
    if (error || !data) {
      settingsCache = { at: now, value: fallback };
      return fallback;
    }
    const fromDb = normalizeModels((data as any).model_chain);
    const value: RuntimeSettings = {
      isEnabled: (data as any).is_enabled !== false,
      failoverEnabled: (data as any).failover_enabled !== false,
      models: fromDb.length ? fromDb : (parseEnvChain() || builtInChain()),
    };
    // Env chain still wins if set (ops override)
    const envChain = parseEnvChain();
    if (envChain) value.models = envChain;
    settingsCache = { at: now, value };
    return value;
  } catch (e) {
    console.warn("[NVIDIA] ai_runtime_settings load failed:", e);
    settingsCache = { at: now, value: fallback };
    return fallback;
  }
}

/** Test helper / UI sync — clear cache after settings save if needed. */
export function clearNvidiaSettingsCache() {
  settingsCache = null;
}

export function resolveApiKey(): string {
  return Deno.env.get("NVIDIA_API_KEY") || Deno.env.get("DEEPSEEK_API_KEY") || "";
}

export function isFailoverHttp(status: number, bodyText: string): boolean {
  if (status === 429 || status === 503 || status === 529) return true;
  if (status === 404) return true;
  if (status === 401 || status === 403) {
    if (/quota|exceed|exhausted|credit/i.test(bodyText)) return true;
  }
  if (status === 400 && /model|not found|does not exist|unknown model/i.test(bodyText)) {
    return true;
  }
  return false;
}

export function mapNvidiaHttpError(status: number, text: string, model?: string): never {
  console.error(`[NVIDIA] ${status} model=${model || "?"}:`, text.slice(0, 500));
  if (status === 429) {
    throw new NvidiaChatError("요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", 429, "RATE_LIMIT", model);
  }
  if (status === 529 || status === 503) {
    throw new NvidiaChatError(
      "AI 서버가 일시적으로 과부하입니다. 잠시 후 다시 시도해주세요.",
      status,
      "RATE_LIMIT",
      model,
    );
  }
  if (status === 404 || (status === 400 && /model|not found|does not exist|unknown model/i.test(text))) {
    throw new NvidiaChatError(`NVIDIA 모델을 찾을 수 없습니다: ${model || "?"}`, 404, "MODEL_NOT_FOUND", model);
  }
  if (status === 401 || status === 403) {
    if (/quota|exceed|exhausted|credit/i.test(text)) {
      throw new NvidiaChatError("NVIDIA API 할당량이 소진되었습니다. 사용량을 확인해주세요.", 402, "QUOTA_EXHAUSTED", model);
    }
    throw new NvidiaChatError(
      "NVIDIA API 키가 유효하지 않습니다. NVIDIA_API_KEY(Supabase Edge Secrets)를 확인해주세요.",
      403,
      "INVALID_KEY",
      model,
    );
  }
  if (status === 400) {
    throw new NvidiaChatError(`NVIDIA 요청 오류: ${text.slice(0, 200)}`, 400, "BAD_REQUEST", model);
  }
  throw new NvidiaChatError(`NVIDIA AI 서버 오류 (${status})`, status, "SERVER_ERROR", model);
}

function withTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

export type NvidiaChatRequest = {
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  timeoutMs?: number;
  /** Retries on the same model before trying the next (default 2 when failover on, 3 when off). */
  maxAttemptsPerModel?: number;
  /** Extra body fields (e.g. chat_template_kwargs). */
  extraBody?: Record<string, unknown>;
  /** Optional ordered model list — skips DB/env default chain when set. */
  models?: string[];
};

export type NvidiaChatResult = {
  content: string;
  model: string;
  fallbackFrom?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  raw?: unknown;
};

async function resolveModelsForCall(): Promise<{
  models: string[];
  failoverEnabled: boolean;
}> {
  const settings = await loadRuntimeSettings();
  if (!settings.isEnabled) {
    throw new NvidiaChatError(
      "AI 자동생성이 비활성화되어 있습니다. 설정 > AI 설정에서 활성화하세요.",
      503,
      "DISABLED",
    );
  }
  const models = settings.models.length ? settings.models : builtInChain();
  if (!settings.failoverEnabled) {
    return { models: [models[0]], failoverEnabled: false };
  }
  return { models, failoverEnabled: true };
}

/**
 * Non-streaming chat completion with model-chain failover.
 */
export async function callNvidiaChat(req: NvidiaChatRequest): Promise<NvidiaChatResult> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new NvidiaChatError(
      "NVIDIA_API_KEY가 설정되지 않았습니다. Supabase Edge Secrets에 nvapi- 키를 등록해야 합니다.",
      500,
      "INVALID_KEY",
    );
  }

  const resolved = await resolveModelsForCall();
  const failoverEnabled = resolved.failoverEnabled;
  const overrideModels = Array.isArray(req.models)
    ? req.models.map((m) => String(m || "").trim()).filter(Boolean)
    : [];
  const models = overrideModels.length ? overrideModels : resolved.models;
  const timeoutMs = req.timeoutMs ??
    (Number(Deno.env.get("DEEPSEEK_TIMEOUT_MS") || Deno.env.get("NVIDIA_TIMEOUT_MS") || 90_000) || 90_000);
  const maxAttemptsPerModel = Math.max(
    1,
    Math.min(4, req.maxAttemptsPerModel ?? (failoverEnabled ? 2 : 3)),
  );
  const maxLlmCalls = resolveMaxLlmCallsPerRequest();
  let llmCalls = 0;

  let lastErr: unknown;
  let firstModel = models[0];

  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    for (let attempt = 1; attempt <= maxAttemptsPerModel; attempt++) {
      if (llmCalls >= maxLlmCalls) {
        throw new NvidiaChatError(
          `AI 호출 상한(${maxLlmCalls}회/요청)에 도달했습니다. 재시도를 중단합니다.`,
          429,
          "CALL_CAP",
          model,
        );
      }
      llmCalls++;
      const { signal, clear } = withTimeoutSignal(timeoutMs);
      try {
        const body: Record<string, unknown> = {
          model,
          messages: req.messages,
          temperature: typeof req.temperature === "number" ? req.temperature : 0.4,
          max_tokens: typeof req.max_tokens === "number" ? req.max_tokens : 6000,
          stream: false,
          chat_template_kwargs: { enable_thinking: false, thinking: false },
          ...(req.extraBody || {}),
        };

        const resp = await fetch(NVIDIA_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
          },
          signal,
          body: JSON.stringify(body),
        });

        if (!resp.ok) {
          const text = await resp.text();
          const failover = failoverEnabled && isFailoverHttp(resp.status, text);
          if (failover && mi < models.length - 1) {
            console.warn(
              `[NVIDIA] failover ${model} → ${models[mi + 1]} status=${resp.status} calls=${llmCalls}/${maxLlmCalls}`,
            );
            lastErr = new NvidiaChatError(text.slice(0, 200), resp.status, "RATE_LIMIT", model);
            break; // next model
          }
          // Same-model retry for transient limits when no next model or failover off
          if ((resp.status === 429 || resp.status === 503 || resp.status === 529) &&
            attempt < maxAttemptsPerModel) {
            console.warn(`[NVIDIA] retry ${model} attempt ${attempt}/${maxAttemptsPerModel} calls=${llmCalls}/${maxLlmCalls}`);
            await new Promise((r) => setTimeout(r, 800 * attempt));
            continue;
          }
          mapNvidiaHttpError(resp.status, text, model);
        }

        const data = await resp.json();
        let content = String(data?.choices?.[0]?.message?.content ?? "").trim();
        // Thinking models sometimes leave content empty and put JSON in reasoning_*
        if (!content) {
          const msg = data?.choices?.[0]?.message || {};
          const reasoning = String(msg.reasoning_content || msg.reasoning || "").trim();
          if (reasoning) {
            const extracted = reasoning.match(/[\[{][\s\S]*[\]}]/);
            content = (extracted ? extracted[0] : reasoning).trim();
            console.warn(`[NVIDIA] salvaged empty content from reasoning model=${model}`);
          }
        }
        const usage = data?.usage as NvidiaChatResult["usage"];
        console.log("[NVIDIA] usage", {
          model,
          prompt_tokens: usage?.prompt_tokens,
          completion_tokens: usage?.completion_tokens,
          total_tokens: usage?.total_tokens,
          llm_calls: llmCalls,
          max_llm_calls: maxLlmCalls,
          fallback_from: mi > 0 ? firstModel : undefined,
        });
        if (mi > 0) {
          console.log(`[NVIDIA] used fallback model=${model} from=${firstModel}`);
        }
        return {
          content,
          model,
          fallbackFrom: mi > 0 ? firstModel : undefined,
          usage,
          raw: data,
        };
      } catch (e) {
        lastErr = e;
        if (e instanceof NvidiaChatError) {
          if (
            failoverEnabled &&
            (e.code === "RATE_LIMIT" || e.code === "QUOTA_EXHAUSTED" || e.code === "MODEL_NOT_FOUND" ||
              e.code === "TIMEOUT") &&
            mi < models.length - 1
          ) {
            break; // next model
          }
          if (e.code === "RATE_LIMIT" && attempt < maxAttemptsPerModel) {
            await new Promise((r) => setTimeout(r, 800 * attempt));
            continue;
          }
          throw e;
        }
        if ((e as Error)?.name === "AbortError") {
          const timeoutErr = new NvidiaChatError(
            `AI 요청이 ${timeoutMs}ms 내 완료되지 않아 중단되었습니다.`,
            504,
            "TIMEOUT",
            model,
          );
          if (failoverEnabled && mi < models.length - 1) {
            console.warn(`[NVIDIA] timeout failover ${model} → ${models[mi + 1]}`);
            lastErr = timeoutErr;
            break;
          }
          throw timeoutErr;
        }
        throw new NvidiaChatError(
          e instanceof Error ? e.message : "NVIDIA 네트워크 오류",
          500,
          "SERVER_ERROR",
          model,
        );
      } finally {
        clear();
      }
    }
  }

  if (lastErr instanceof NvidiaChatError) throw lastErr;
  throw new NvidiaChatError("NVIDIA 모델 체인 요청 실패", 500, "SERVER_ERROR");
}

/**
 * Streaming chat — tries next model only if the initial HTTP response fails.
 * Mid-stream errors are not retried on another model.
 */
export async function* streamNvidiaChatText(
  req: NvidiaChatRequest,
): AsyncGenerator<string, void, unknown> {
  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new NvidiaChatError(
      "NVIDIA_API_KEY가 설정되지 않았습니다. Supabase Edge Secrets에 nvapi- 키를 등록해야 합니다.",
      500,
      "INVALID_KEY",
    );
  }

  const { models, failoverEnabled } = await resolveModelsForCall();
  const timeoutMs = Math.max(
    req.timeoutMs ??
      (Number(Deno.env.get("DEEPSEEK_TIMEOUT_MS") || Deno.env.get("NVIDIA_TIMEOUT_MS") || 90_000) || 90_000),
    120_000,
  );
  const idleMs = Math.min(45_000, timeoutMs);

  let lastErr: unknown;

  for (let mi = 0; mi < models.length; mi++) {
    const model = models[mi];
    const controller = new AbortController();
    let idleTimer = setTimeout(() => controller.abort(), idleMs);
    const bumpIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), idleMs);
    };
    const wallTimer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const body: Record<string, unknown> = {
        model,
        messages: req.messages,
        temperature: typeof req.temperature === "number" ? req.temperature : 0.45,
        max_tokens: typeof req.max_tokens === "number" ? req.max_tokens : 6000,
        stream: true,
        chat_template_kwargs: { enable_thinking: false, thinking: false },
        ...(req.extraBody || {}),
      };

      const resp = await fetch(NVIDIA_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          Authorization: `Bearer ${apiKey}`,
          Accept: "text/event-stream",
        },
        signal: controller.signal,
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text();
        if (failoverEnabled && isFailoverHttp(resp.status, text) && mi < models.length - 1) {
          console.warn(`[NVIDIA stream] failover ${model} → ${models[mi + 1]} status=${resp.status}`);
          lastErr = new NvidiaChatError(text.slice(0, 200), resp.status, "RATE_LIMIT", model);
          continue;
        }
        mapNvidiaHttpError(resp.status, text, model);
      }
      if (!resp.body) {
        throw new NvidiaChatError("NVIDIA 스트림 응답이 비어 있습니다.", 500, "SERVER_ERROR", model);
      }

      if (mi > 0) {
        console.log(`[NVIDIA stream] used fallback model=${model} from=${models[0]}`);
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
            const delta =
              parsed?.choices?.[0]?.delta?.content ??
              parsed?.choices?.[0]?.message?.content ??
              "";
            if (typeof delta === "string" && delta) yield delta;
          } catch {
            /* ignore partial SSE JSON */
          }
        }
      }
      return; // success
    } catch (e) {
      lastErr = e;
      if (e instanceof NvidiaChatError) {
        if (
          failoverEnabled &&
          (e.code === "RATE_LIMIT" || e.code === "QUOTA_EXHAUSTED" || e.code === "MODEL_NOT_FOUND") &&
          mi < models.length - 1
        ) {
          continue;
        }
        throw e;
      }
      if ((e as Error)?.name === "AbortError") {
        throw new NvidiaChatError(
          `NVIDIA 스트림이 ${timeoutMs}ms 내 완료되지 않아 중단되었습니다.`,
          504,
          "TIMEOUT",
          model,
        );
      }
      throw new NvidiaChatError(
        e instanceof Error ? e.message : "NVIDIA 스트림 네트워크 오류",
        500,
        "SERVER_ERROR",
        model,
      );
    } finally {
      clearTimeout(idleTimer);
      clearTimeout(wallTimer);
    }
  }

  if (lastErr instanceof NvidiaChatError) throw lastErr;
  throw new NvidiaChatError("NVIDIA 스트림 모델 체인 실패", 500, "SERVER_ERROR");
}

/** Primary model id for logs/UI (first in resolved chain, sync env/default only). */
export function peekPrimaryModelSync(): string {
  const envChain = parseEnvChain();
  if (envChain?.[0]) return envChain[0];
  const override = Deno.env.get("RISK_AI_MODEL")?.trim() || Deno.env.get("NVIDIA_MODEL")?.trim();
  if (override) return override;
  return DEFAULT_PRIMARY_MODEL;
}
