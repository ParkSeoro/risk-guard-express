// Shared AI client — NVIDIA NIM (OpenAI-compatible) adapter.
// Filename kept for backward compatibility; internal logic now targets
// NVIDIA integrate.api.nvidia.com with a fixed mixtral-8x7b-instruct model.
// All request/response shapes remain OpenAI chat-completions compatible so
// existing callers keep working unchanged.

const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_MODEL = "mistralai/mixtral-8x7b-instruct-v0.1";

// Retained exports (values unused now — model is forced) so imports don't break.
export const GEMINI_DEFAULT_MODEL = NVIDIA_MODEL;
export const GEMINI_LITE_MODEL = NVIDIA_MODEL;

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

export class GeminiError extends Error {
  status: number;
  code: "RATE_LIMIT" | "QUOTA_EXHAUSTED" | "INVALID_KEY" | "SAFETY_BLOCK" | "BAD_REQUEST" | "SERVER_ERROR";
  constructor(message: string, status: number, code: GeminiError["code"]) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// mixtral-8x7b-instruct is text-only. Flatten any multimodal blocks to text
// so callers that used to pass images (e.g. permit template analysis) keep
// working without a hard crash.
function flattenContent(content: OAIMessage["content"]): string {
  if (typeof content === "string") return content;
  return content
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "image_url") return "[image omitted — vision not supported by current model]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

// Detect whether a request carries image inputs (image_url block or base64 image data URL).
function hasImageInput(messages: OAIMessage[]): boolean {
  for (const m of messages) {
    if (typeof m.content === "string") {
      if (/data:image\/[a-zA-Z0-9.+-]+;base64,/.test(m.content)) return true;
      continue;
    }
    for (const block of m.content) {
      if (block.type === "image_url") return true;
      if (block.type === "text" && /data:image\/[a-zA-Z0-9.+-]+;base64,/.test(block.text)) return true;
    }
  }
  return false;
}

// Strip markdown code fences (```json ... ```), then JSON.parse defensively.
// Kept as an exported helper so callers can drop their own ad-hoc regex.
export function parseJsonLoose<T = unknown>(raw: string): T {
  let text = (raw || "").trim();
  // Remove leading ```json / ``` and trailing ```
  text = text.replace(/^\s*```(?:json|JSON)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  // If model wrapped output in prose, try to extract the first {...} or [...] block.
  if (!/^[\[{]/.test(text)) {
    const match = text.match(/[\[{][\s\S]*[\]}]/);
    if (match) text = match[0];
  }
  return JSON.parse(text) as T;
}

const FORCE_JSON_SUFFIX =
  "\n\nYou MUST respond ONLY with valid JSON. Do not include any markdown formatting like ```json or explanatory text.";

function injectJsonInstruction(messages: OAIMessage[]): OAIMessage[] {
  const out = messages.map((m) => ({ ...m }));
  const sysIdx = out.findIndex((m) => m.role === "system");
  if (sysIdx >= 0) {
    const cur = out[sysIdx];
    const asText = typeof cur.content === "string" ? cur.content : flattenContent(cur.content);
    out[sysIdx] = { role: "system", content: asText + FORCE_JSON_SUFFIX };
  } else {
    out.unshift({ role: "system", content: FORCE_JSON_SUFFIX.trim() });
  }
  return out;
}


/**
 * Call NVIDIA NIM using an OpenAI-style chat body.
 * Returns an OpenAI-style response object.
 */
export async function callGeminiChat(req: OAIRequest): Promise<OAIResponse> {
  const apiKey = Deno.env.get("NVIDIA_API_KEY");
  if (!apiKey) {
    throw new GeminiError(
      "NVIDIA_API_KEY가 설정되지 않았습니다. 마스터가 설정 > 시크릿에서 등록해야 합니다.",
      500,
      "INVALID_KEY",
    );
  }

  const wantsJson = req.response_format?.type === "json_object";
  const imagePresent = hasImageInput(req.messages);

  // If caller explicitly needs vision (image is the primary payload) — signal clearly.
  // Heuristic: image present AND user text is short/empty (< 40 chars of real text).
  if (imagePresent) {
    const totalText = req.messages
      .filter((m) => m.role === "user")
      .map((m) => flattenContent(m.content).replace(/\[image omitted[^\]]*\]/g, "").trim())
      .join(" ")
      .trim();
    if (totalText.length < 40) {
      throw new GeminiError(
        "현재 AI 모델은 이미지(사진) 분석을 지원하지 않습니다. 텍스트로 직접 입력해 주세요.",
        400,
        "BAD_REQUEST",
      );
    }
    // Otherwise strip images silently and continue with text.
  }

  const preparedMessages = wantsJson ? injectJsonInstruction(req.messages) : req.messages;
  const messages = preparedMessages.map((m) => ({
    role: m.role,
    content: flattenContent(m.content),
  }));

  const body: Record<string, unknown> = {
    model: NVIDIA_MODEL, // forced
    messages,
    temperature: typeof req.temperature === "number" ? req.temperature : 0.4,
    max_tokens: typeof req.max_tokens === "number" ? req.max_tokens : 2048,
    stream: false,
  };
  // NVIDIA NIM may not honor response_format reliably; rely on prompt injection instead.


  const resp = await fetch(NVIDIA_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error(`[NVIDIA] ${resp.status}:`, text.slice(0, 500));
    if (resp.status === 429) {
      throw new GeminiError("요청이 너무 많습니다. 잠시 후 다시 시도해주세요.", 429, "RATE_LIMIT");
    }
    if (resp.status === 401 || resp.status === 403) {
      if (/quota|exceed|exhausted|credit/i.test(text)) {
        throw new GeminiError("NVIDIA API 할당량이 소진되었습니다. 사용량을 확인해주세요.", 402, "QUOTA_EXHAUSTED");
      }
      throw new GeminiError("NVIDIA API 키가 유효하지 않습니다. 키를 다시 등록해주세요.", 403, "INVALID_KEY");
    }
    if (resp.status === 400) {
      throw new GeminiError(`NVIDIA 요청 오류: ${text.slice(0, 200)}`, 400, "BAD_REQUEST");
    }
    throw new GeminiError(`NVIDIA 서버 오류 (${resp.status})`, resp.status, "SERVER_ERROR");
  }

  const data = await resp.json();
  const choice = data.choices?.[0];
  const content: string = choice?.message?.content || "";

  return {
    choices: [
      {
        message: { role: "assistant", content },
        finish_reason: choice?.finish_reason || "stop",
      },
    ],
    usage: data.usage
      ? {
          prompt_tokens: data.usage.prompt_tokens || 0,
          completion_tokens: data.usage.completion_tokens || 0,
          total_tokens: data.usage.total_tokens || 0,
        }
      : undefined,
  };
}

/**
 * Fetch-like wrapper for drop-in replacement of `fetch(AI_URL, ...)`.
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
