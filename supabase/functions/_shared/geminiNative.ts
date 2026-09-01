/**
 * Real Google Gemini generateContent client (not the NVIDIA adapter in gemini.ts).
 * Text default: gemini-2.5-flash-lite (cheaper than gpt-4o-mini).
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

export function resolveGeminiApiKey(): string {
  return (Deno.env.get("GEMINI_API_KEY") || "").trim();
}

export function resolveGeminiTextModel(): string {
  return Deno.env.get("GEMINI_TEXT_MODEL")?.trim() || "gemini-2.5-flash-lite";
}

export function resolveGeminiVisionModel(): string {
  return Deno.env.get("GEMINI_VISION_MODEL")?.trim() || "gemini-2.5-flash";
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
  const apiKey = resolveGeminiApiKey();
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
  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent` +
    `?key=${encodeURIComponent(apiKey)}`;

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
      headers: { "Content-Type": "application/json" },
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
