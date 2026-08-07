/**
 * Optional OpenAI ChatGPT client — LAST-RESORT fallback for risk AI.
 *
 * Primary path remains NVIDIA NIM (see ../_shared/nvidiaChat.ts).
 * Lives next to index.ts so Supabase Dashboard bundling can find it.
 * This module is dormant unless OPENAI_API_KEY is set in Edge secrets.
 *
 * Env:
 *   OPENAI_API_KEY          — required to enable
 *   OPENAI_BASE_URL         — default https://api.openai.com/v1
 *   OPENAI_MODEL            — default gpt-4o-mini (draft/fill shared default)
 *   OPENAI_DRAFT_MODEL      — optional override for scope_draft
 *   OPENAI_FILL_MODEL       — optional override for risk_fill
 *   RISK_AI_OPENAI_FALLBACK — default true when key present; set 0/false to disable
 *   RISK_AI_DRAFT_PROVIDER  — openai | nvidia (default nvidia). Use openai to try ChatGPT first on scope_draft.
 *   OPENAI_TIMEOUT_MS       — default 45000
 */

export type OpenAiChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export class OpenAiChatError extends Error {
  status: number;
  code: "DISABLED" | "INVALID_KEY" | "TIMEOUT" | "RATE_LIMIT" | "BAD_REQUEST" | "SERVER_ERROR";
  constructor(
    message: string,
    status: number,
    code: OpenAiChatError["code"],
  ) {
    super(message);
    this.name = "OpenAiChatError";
    this.status = status;
    this.code = code;
  }
}

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = Deno.env.get(name);
  if (raw == null || raw === "") return defaultValue;
  return !/^(0|false|no|off)$/i.test(raw.trim());
}

export function resolveOpenAiApiKey(): string {
  return (Deno.env.get("OPENAI_API_KEY") || "").trim();
}

/** True only when key exists and fallback is not explicitly disabled. */
export function isOpenAiFallbackEnabled(): boolean {
  if (!resolveOpenAiApiKey()) return false;
  return envFlag("RISK_AI_OPENAI_FALLBACK", true);
}

/** Prefer OpenAI before NVIDIA for scope_draft when explicitly configured. */
export function preferOpenAiForDraft(): boolean {
  if (!isOpenAiFallbackEnabled()) return false;
  const raw = (Deno.env.get("RISK_AI_DRAFT_PROVIDER") || "nvidia").trim().toLowerCase();
  return raw === "openai" || raw === "chatgpt" || raw === "gpt";
}

function resolveBaseUrl(): string {
  return (Deno.env.get("OPENAI_BASE_URL") || "https://api.openai.com/v1").replace(/\/+$/, "");
}

function resolveTimeoutMs(): number {
  const raw = Number(Deno.env.get("OPENAI_TIMEOUT_MS") || 45_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 45_000;
}

export function resolveOpenAiModel(kind: "draft" | "fill" | "default" = "default"): string {
  if (kind === "draft") {
    return (
      Deno.env.get("OPENAI_DRAFT_MODEL")?.trim() ||
      Deno.env.get("OPENAI_MODEL")?.trim() ||
      "gpt-4o-mini"
    );
  }
  if (kind === "fill") {
    return (
      Deno.env.get("OPENAI_FILL_MODEL")?.trim() ||
      Deno.env.get("OPENAI_MODEL")?.trim() ||
      "gpt-4o-mini"
    );
  }
  return Deno.env.get("OPENAI_MODEL")?.trim() || "gpt-4o-mini";
}

export type OpenAiChatRequest = {
  messages: OpenAiChatMessage[];
  temperature?: number;
  max_tokens?: number;
  timeoutMs?: number;
  /** draft | fill picks env model overrides */
  purpose?: "draft" | "fill";
  model?: string;
};

export type OpenAiChatResult = {
  content: string;
  model: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

/**
 * Non-streaming Chat Completions. Throws if key missing / disabled.
 */
export async function callOpenAiChat(req: OpenAiChatRequest): Promise<OpenAiChatResult> {
  if (!isOpenAiFallbackEnabled()) {
    throw new OpenAiChatError(
      "OpenAI 폴백이 비활성입니다. OPENAI_API_KEY를 등록하거나 RISK_AI_OPENAI_FALLBACK을 확인하세요.",
      503,
      "DISABLED",
    );
  }

  const apiKey = resolveOpenAiApiKey();
  const model = req.model || resolveOpenAiModel(req.purpose || "default");
  const timeoutMs = req.timeoutMs ?? resolveTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const resp = await fetch(`${resolveBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: req.messages,
        temperature: typeof req.temperature === "number" ? req.temperature : 0.2,
        max_tokens: typeof req.max_tokens === "number" ? req.max_tokens : 2000,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    const text = await resp.text();
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        throw new OpenAiChatError(
          "OpenAI API 키가 유효하지 않습니다. OPENAI_API_KEY를 확인하세요.",
          resp.status,
          "INVALID_KEY",
        );
      }
      if (resp.status === 429) {
        throw new OpenAiChatError("OpenAI 요청 한도 초과. 잠시 후 다시 시도하세요.", 429, "RATE_LIMIT");
      }
      if (resp.status === 400) {
        throw new OpenAiChatError(`OpenAI 요청 오류: ${text.slice(0, 200)}`, 400, "BAD_REQUEST");
      }
      throw new OpenAiChatError(
        `OpenAI 서버 오류 (${resp.status}): ${text.slice(0, 160)}`,
        resp.status,
        "SERVER_ERROR",
      );
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch {
      throw new OpenAiChatError("OpenAI 응답 JSON 파싱 실패", 500, "SERVER_ERROR");
    }

    const content = String(data?.choices?.[0]?.message?.content ?? "").trim();
    if (!content) {
      throw new OpenAiChatError("OpenAI 응답이 비어 있습니다.", 500, "SERVER_ERROR");
    }

    console.log(`[OpenAI-fallback] ok model=${model}`);
    return {
      content,
      model,
      usage: data?.usage,
    };
  } catch (e) {
    if (e instanceof OpenAiChatError) throw e;
    if ((e as Error)?.name === "AbortError") {
      throw new OpenAiChatError(
        `OpenAI 요청이 ${timeoutMs}ms 내 완료되지 않아 중단되었습니다.`,
        504,
        "TIMEOUT",
      );
    }
    throw new OpenAiChatError(
      e instanceof Error ? e.message : "OpenAI 네트워크 오류",
      500,
      "SERVER_ERROR",
    );
  } finally {
    clearTimeout(timer);
  }
}
