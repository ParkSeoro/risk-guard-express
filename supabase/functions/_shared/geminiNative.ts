/**
 * Real Google Gemini generateContent client (not the NVIDIA adapter in gemini.ts).
 * Text default: gemini-3.5-flash-lite. gemini-2.5-flash-lite is closed to new keys.
 * Vision default: gemini-2.5-flash (OCR / 양식).
 */

export class GeminiNativeError extends Error {
  status: number;
  code: "RATE_LIMIT" | "QUOTA_EXHAUSTED" | "INVALID_KEY" | "BAD_REQUEST" | "SERVER_ERROR";
  constructor(message: string, status: number, code: GeminiNativeError["code"]) {
    super(message);
    this.name = "GeminiNativeError";
    this.status = status;
    this.code = code;
  }
}

const VAULT_SECRET_NAME = "GEMINI_API_KEY";
const KEY_CACHE_MS = 60_000;
/** Closed to authorization keys created after 2026-05. A dashboard override of this name must not win. */
const RETIRED_TEXT_MODELS = new Set(["gemini-2.5-flash-lite"]);

let cachedKey: { value: string; at: number } | null = null;

async function readVaultGeminiKey(): Promise<string> {
  const url = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const service = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!url || !service) return "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const resp = await fetch(`${url}/rest/v1/rpc/get_runtime_secret`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: service,
        Authorization: `Bearer ${service}`,
      },
      body: JSON.stringify({ secret_name: VAULT_SECRET_NAME }),
      signal: controller.signal,
    });
    if (!resp.ok) return "";
    const data = await resp.json().catch(() => null);
    return typeof data === "string" ? data.trim() : "";
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

/** Vault wins over GEMINI_API_KEY so a stale edge secret does not keep the old key. */
export async function resolveGeminiApiKey(): Promise<string> {
  const now = Date.now();
  if (cachedKey && now - cachedKey.at < KEY_CACHE_MS) return cachedKey.value;
  const fromVault = await readVaultGeminiKey();
  const fromEnv = (Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY") || "").trim();
  const value = fromVault || fromEnv;
  cachedKey = { value, at: now };
  return value;
}

export function resolveGeminiTextModel(): string {
  const env = Deno.env.get("GEMINI_TEXT_MODEL")?.trim() || "";
  if (env && !RETIRED_TEXT_MODELS.has(env)) return env;
  return "gemini-3.5-flash-lite";
}

export function resolveGeminiVisionModel(): string {
  return Deno.env.get("GEMINI_VISION_MODEL")?.trim() || "gemini-2.5-flash";
}

/**
 * High-reasoning engineering model cascade for Plant AI Lab (P&ID, 3D, PMIS).
 * Honors GEMINI_ENGINEERING_MODEL secret if set (e.g. gemini-3.8-flash / gemini-2.5-pro),
 * then falls back gracefully through flagship multimodal models.
 */
export function resolveGeminiEngineeringModels(): string[] {
  const custom = Deno.env.get("GEMINI_ENGINEERING_MODEL")?.trim();
  const list = [
    ...(custom ? [custom] : []),
    "gemini-2.5-pro",
    "gemini-2.5-flash",
  ];
  return Array.from(new Set(list));
}

export async function callGeminiEngineeringJson(req: {
  prompt: string;
  images?: { base64: string; mimeType: string }[];
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): Promise<{ parsed: unknown; model: string }> {
  const apiKey = await resolveGeminiApiKey();
  if (!apiKey) {
    throw new GeminiNativeError("GEMINI_API_KEY가 설정되지 않았습니다.", 500, "INVALID_KEY");
  }

  const parts: Array<Record<string, unknown>> = [{ text: req.prompt }];
  for (const img of req.images || []) {
    if (img?.base64) {
      parts.push({
        inline_data: {
          mime_type: img.mimeType || "image/jpeg",
          data: img.base64,
        },
      });
    }
  }

  const models = resolveGeminiEngineeringModels();
  let lastError = "Gemini 모델 호출 실패";

  for (const model of models) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 60_000);
    try {
      const generationConfig: Record<string, unknown> = {
        temperature: req.temperature ?? 0.15,
        maxOutputTokens: req.maxOutputTokens ?? 6144,
        responseMimeType: "application/json",
      };
      // Disable excessive thinking tokens on flash models for speed; keep moderate budget on pro
      if (/flash/i.test(model)) {
        generationConfig.thinkingConfig = { thinkingBudget: 0 };
      } else if (/pro/i.test(model)) {
        generationConfig.thinkingConfig = { thinkingBudget: 1024 };
      }

      const resp = await fetch(geminiGenerateContentUrl(model), {
        method: "POST",
        headers: geminiRequestHeaders(apiKey),
        body: JSON.stringify({
          contents: [{ role: "user", parts }],
          generationConfig,
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errTxt = await resp.text().catch(() => "");
        lastError = `${model} HTTP ${resp.status}: ${errTxt.slice(0, 220)}`;
        // Try next model on 404/400/429/503
        if ([400, 404, 429, 500, 503].includes(resp.status)) continue;
        throw new GeminiNativeError(lastError, resp.status, "SERVER_ERROR");
      }

      const data = await resp.json();
      const rawText = (data?.candidates?.[0]?.content?.parts || [])
        .map((p: { text?: string }) => p.text || "")
        .join("\n")
        .trim();
      const cleaned = rawText
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      if (!cleaned) {
        lastError = `${model} returned empty content`;
        continue;
      }
      const parsed = JSON.parse(cleaned);
      return { parsed, model };
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
      continue;
    } finally {
      clearTimeout(timer);
    }
  }

  throw new GeminiNativeError(`모든 엔지니어링 AI 모델 호출 실패: ${lastError}`, 502, "SERVER_ERROR");
}

/** Auth keys (AQ.*) are rejected when the key is placed in the query string. */
export function geminiGenerateContentUrl(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
}

export function geminiRequestHeaders(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-goog-api-key": apiKey,
  };
}

type ChatPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type ChatMessage = { role: string; content: string | ChatPart[] };

function flattenText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  return content.map((p) => (p.type === "text" ? p.text : "")).filter(Boolean).join("\n");
}

function parseDataUrl(url: string): { mime: string; data: string } | null {
  const m = String(url || "").match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return null;
  return { mime: m[1], data: m[2] };
}

function toGeminiParts(content: ChatMessage["content"]): Array<Record<string, unknown>> {
  if (typeof content === "string") return [{ text: content }];
  const parts: Array<Record<string, unknown>> = [];
  for (const p of content) {
    if (p.type === "text" && p.text) parts.push({ text: p.text });
    if (p.type === "image_url") {
      const parsed = parseDataUrl(p.image_url?.url || "");
      if (parsed) parts.push({ inline_data: { mime_type: parsed.mime, data: parsed.data } });
    }
  }
  return parts.length ? parts : [{ text: "" }];
}

function hasImage(messages: ChatMessage[]): boolean {
  return messages.some((m) => {
    if (typeof m.content === "string") return /data:image\//.test(m.content);
    return m.content.some((p) => p.type === "image_url");
  });
}

export async function callGeminiNativeChat(req: {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  timeoutMs?: number;
}): Promise<{ content: string; model: string }> {
  const apiKey = await resolveGeminiApiKey();
  if (!apiKey) {
    throw new GeminiNativeError("GEMINI_API_KEY가 설정되지 않았습니다.", 500, "INVALID_KEY");
  }

  const image = hasImage(req.messages);
  const model = image ? resolveGeminiVisionModel() : resolveGeminiTextModel();
  const system = req.messages
    .filter((m) => m.role === "system")
    .map((m) => flattenText(m.content))
    .filter(Boolean)
    .join("\n\n");
  const contents = req.messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: toGeminiParts(m.content),
    }));

  const timeoutMs = req.timeoutMs ?? 90_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const url = geminiGenerateContentUrl(model);

  try {
    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: typeof req.temperature === "number" ? req.temperature : 0.2,
        maxOutputTokens: typeof req.maxTokens === "number" ? req.maxTokens : 4096,
        ...(req.json ? { responseMimeType: "application/json" } : {}),
      },
    };
    if (system) body.systemInstruction = { parts: [{ text: system }] };

    const resp = await fetch(url, {
      method: "POST",
      headers: geminiRequestHeaders(apiKey),
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const msg = String(json?.error?.message || `Gemini HTTP ${resp.status}`);
      if (resp.status === 429) throw new GeminiNativeError(msg, 429, "RATE_LIMIT");
      if (resp.status === 401 || resp.status === 403) throw new GeminiNativeError(msg, resp.status, "INVALID_KEY");
      if (/quota|exceed|RESOURCE_EXHAUSTED/i.test(msg)) {
        throw new GeminiNativeError(msg, 402, "QUOTA_EXHAUSTED");
      }
      if (resp.status === 400) throw new GeminiNativeError(msg, 400, "BAD_REQUEST");
      throw new GeminiNativeError(msg, resp.status, "SERVER_ERROR");
    }
    const parts = json?.candidates?.[0]?.content?.parts || [];
    const content = parts.map((p: { text?: string }) => p.text || "").join("\n").trim();
    if (!content) throw new GeminiNativeError("Gemini 응답이 비어 있습니다.", 500, "SERVER_ERROR");
    console.log(`[gemini-native] ok model=${model}`);
    return { content, model };
  } catch (e) {
    if (e instanceof GeminiNativeError) throw e;
    if ((e as Error)?.name === "AbortError") {
      throw new GeminiNativeError(`Gemini 요청이 ${timeoutMs}ms 내 완료되지 않아 중단되었습니다.`, 504, "SERVER_ERROR");
    }
    throw new GeminiNativeError(e instanceof Error ? e.message : "Gemini 네트워크 오류", 500, "SERVER_ERROR");
  } finally {
    clearTimeout(timer);
  }
}
