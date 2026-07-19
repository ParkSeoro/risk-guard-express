// Shared Gemini API client — OpenAI chat-completions compatible wrapper
// Calls Google Generative Language REST API directly using GEMINI_API_KEY.
// Lets existing edge functions keep their OpenAI-style request/response code
// with minimal changes (just swap URL+key for callGeminiChat()).

export const GEMINI_DEFAULT_MODEL = "gemini-2.5-flash";
export const GEMINI_LITE_MODEL = "gemini-2.5-flash-lite";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Map model alias → Gemini native model id
function resolveGeminiModel(model?: string): string {
  if (!model) return GEMINI_DEFAULT_MODEL;
  const m = model.toLowerCase();
  if (m.includes("lite")) return GEMINI_LITE_MODEL;
  if (m.includes("pro")) return "gemini-2.5-pro";
  if (m.includes("flash")) return GEMINI_DEFAULT_MODEL;
  // Any "google/..." or "gpt-..." → use default flash
  return GEMINI_DEFAULT_MODEL;
}

type OAIMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string } }
  >;
};

interface OAIRequest {
  model?: string;
  messages: OAIMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" | "text" };
}

interface OAIResponse {
  choices: Array<{
    message: { role: "assistant"; content: string };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

function partsFromContent(content: OAIMessage["content"]): any[] {
  if (typeof content === "string") return [{ text: content }];
  return content.map((block) => {
    if (block.type === "text") return { text: block.text };
    if (block.type === "image_url") {
      const url = block.image_url.url;
      // data:image/png;base64,xxxx
      const m = url.match(/^data:([^;]+);base64,(.+)$/);
      if (m) return { inlineData: { mimeType: m[1], data: m[2] } };
      // External URL — Gemini supports fileData with URI, but it must be publicly fetchable
      return { fileData: { mimeType: "image/jpeg", fileUri: url } };
    }
    return { text: "" };
  });
}

export class GeminiError extends Error {
  status: number;
  code: "RATE_LIMIT" | "QUOTA_EXHAUSTED" | "INVALID_KEY" | "SAFETY_BLOCK" | "BAD_REQUEST" | "SERVER_ERROR";
  constructor(message: string, status: number, code: GeminiError["code"]) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Call Gemini using an OpenAI-style chat-completions body.
 * Returns an OpenAI-style response object.
 */
export async function callGeminiChat(req: OAIRequest): Promise<OAIResponse> {
  const apiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_API_KEY");
  if (!apiKey) {
    throw new GeminiError(
      "GEMINI_API_KEY 또는 GOOGLE_API_KEY가 설정되지 않았습니다. 마스터가 설정 > 시크릿에서 등록해야 합니다.",
      500,
      "INVALID_KEY"
    );
  }

  const modelId = resolveGeminiModel(req.model);

  // Build Gemini body
  const systemMsgs = req.messages.filter((m) => m.role === "system");
  const convo = req.messages.filter((m) => m.role !== "system");

  const systemInstruction = systemMsgs.length
    ? { parts: systemMsgs.flatMap((m) => partsFromContent(m.content)) }
    : undefined;

  const contents = convo.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: partsFromContent(m.content),
  }));

  const generationConfig: Record<string, unknown> = {};
  if (typeof req.temperature === "number") generationConfig.temperature = req.temperature;
  if (typeof req.max_tokens === "number") generationConfig.maxOutputTokens = req.max_tokens;
  if (req.response_format?.type === "json_object") generationConfig.responseMimeType = "application/json";

  const body: Record<string, unknown> = { contents };
  if (systemInstruction) body.systemInstruction = systemInstruction;
  if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

  const url = `${GEMINI_BASE}/${modelId}:generateContent?key=${apiKey}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`[Gemini] ${resp.status}:`, text.slice(0, 500));
    if (resp.status === 429) {
      throw new GeminiError("요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", 429, "RATE_LIMIT");
    }
    if (resp.status === 403) {
      if (/quota|exceeded|exhausted/i.test(text)) {
        throw new GeminiError("Gemini API 무료 할당량이 소진되었습니다. AI Studio에서 한도 확인이 필요합니다.", 402, "QUOTA_EXHAUSTED");
      }
      throw new GeminiError("Gemini API 키가 유효하지 않습니다. 키를 다시 등록해주세요.", 403, "INVALID_KEY");
    }
    if (resp.status === 400) {
      if (/api_key|api key/i.test(text)) {
        throw new GeminiError("Gemini API 키가 유효하지 않습니다.", 403, "INVALID_KEY");
      }
      throw new GeminiError(`Gemini 요청 오류: ${text.slice(0, 200)}`, 400, "BAD_REQUEST");
    }
    throw new GeminiError(`Gemini 서버 오류 (${resp.status})`, resp.status, "SERVER_ERROR");
  }

  const data = await resp.json();
  const candidate = data.candidates?.[0];

  // Safety block
  if (!candidate || candidate.finishReason === "SAFETY") {
    throw new GeminiError("Gemini 안전 필터에 의해 응답이 차단되었습니다.", 400, "SAFETY_BLOCK");
  }

  const text = (candidate.content?.parts || [])
    .map((p: any) => p.text || "")
    .join("");

  const usage = data.usageMetadata
    ? {
        prompt_tokens: data.usageMetadata.promptTokenCount || 0,
        completion_tokens: data.usageMetadata.candidatesTokenCount || 0,
        total_tokens: data.usageMetadata.totalTokenCount || 0,
      }
    : undefined;

  return {
    choices: [
      {
        message: { role: "assistant", content: text },
        finish_reason: candidate.finishReason?.toLowerCase() || "stop",
      },
    ],
    usage,
  };
}

/**
 * Fetch-like wrapper for drop-in replacement of `fetch(AI_GATEWAY_URL, ...)`.
 * Returns a Response object so existing `response.ok` / `response.json()` code works.
 */
export async function geminiChatFetch(body: OAIRequest): Promise<Response> {
  try {
    const result = await callGeminiChat(body);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    if (e instanceof GeminiError) {
      return new Response(JSON.stringify({ error: { message: e.message, code: e.code } }), {
        status: e.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: { message: msg } }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
