// Shared AI client. OpenAI (gpt-4o-mini) is the primary when OPENAI_API_KEY is set.
// NVIDIA NIM is last resort — hosted chain models are mostly 410/404 (2026-08+).

import {
  callNvidiaChat,
  streamNvidiaChatText,
  peekPrimaryModelSync,
  NvidiaChatError,
} from "./nvidiaChat.ts";
import {
  callOpenAiChat,
  isOpenAiFallbackEnabled,
  preferOpenAiForDraft,
  OpenAiChatError,
} from "./openaiChat.ts";

const NVIDIA_MODEL = peekPrimaryModelSync();

// Retained exports so imports don't break.
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
  /** Skip the long Korean style appendix when the caller already embeds full instructions. */
  compact?: boolean;
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

// Current default model is text-only. Flatten any multimodal blocks to text
// so callers that used to pass images (e.g. permit template analysis) keep
// working without a hard crash.
// Safety-cost Korean OCR must NOT go through this path — use koreanOcr.ts
// (Gemini 2.5 Flash vision with inline_data). Do not send images to NVIDIA.
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
export function stripCodeFences(raw: string): string {
  // Remove any ```json / ``` fences anywhere in the string, then trim.
  return (raw || "").replace(/```json/gi, "").replace(/```/g, "").trim();
}

export function parseJsonLoose<T = unknown>(raw: string): T {
  let text = stripCodeFences(raw);
  // If model wrapped output in prose, try to extract the first {...} or [...] block.
  if (!/^[\[{]/.test(text)) {
    const match = text.match(/[\[{][\s\S]*[\]}]/);
    if (match) text = match[0];
  }
  return JSON.parse(text) as T;
}

// [필수 지침: 대한민국 산업안전보건법 및 KOSHA GUIDE 준수]
const KOREAN_STYLE_SUFFIX = `

[필수 지침: 대한민국 건설현장 표준 안전 용어 및 법령 준수]
1. 언어 제한: JSON 키 값을 제외한 모든 출력(제목, 설명, 절차, 내용)은 100% 한국어로만 작성한다. 단 하나의 영단어도 포함해서는 안 된다. 불가피한 고유명사(TBM, KOSHA, PPE 등)만 괄호 병기로 허용한다.
2. 법령 근거: 최신 「산업안전보건법」, 「산업안전보건기준에 관한 규칙」, 「건설기술진흥법」, 「중대재해처벌법」, KOSHA GUIDE(C, G, M 시리즈)를 근거로 작성한다. 위험성평가는 최초·정기·수시 평가 기준을 따른다.
3. 유해·위험요인 도출: 추락, 낙하·비래, 협착·끼임, 감전, 화재·폭발, 붕괴·도괴, 질식, 유해물질 노출, 근골격계 부담, 소음·진동 등 해당 공종에서 발생 가능한 위험을 누락 없이 상세히 도출한다.
4. 감소 대책 우선순위: 반드시 (1) 본질안전(제거·대체) → (2) 공학적 대책(방호장치·격리·환기) → (3) 관리적 대책(작업허가·교육·표지) → (4) 개인보호구(PPE) 순서로 실효성 있게 작성한다. PPE만 나열하는 것은 금지한다.
5. 표준 용어 사용: "굴착기", "이동식 크레인", "고소작업대", "안전대", "안전방망", "작업 개시 전 점검", "본 작업 수행 및 신호수 통제", "작업 종료 후 점검 및 정비", "비상시 조치" 등 현장 표준 용어만 사용한다.
6. 현장 어투: 실무자가 즉시 이해할 수 있는 개조식(명사형) 어조(~함, ~음, ~발생 우려)로 작성한다. 서술형(~할 것, ~합니다), 번역투·피동형·영어식 어순 금지. 쉼표 뒤에는 공백 1칸. 한자 혼용 금지.
7. 수량 준수: 요청된 개수(target_count / batchCount 등)를 정확히 채워서 완전한 JSON 배열로 반환한다. 중간에 끊거나 축약하지 않는다.`;

const FORCE_JSON_SUFFIX =
  "\n\nYou MUST respond ONLY with valid JSON. Do not include any markdown formatting like ```json or explanatory text.";

function injectSystemRules(messages: OAIMessage[], wantsJson: boolean, compact = false): OAIMessage[] {
  // Nemotron Super defaults to reasoning ON; /no_think forces concise content
  // into message.content (otherwise content may be null and only reasoning is filled).
  const suffix = compact
    ? (wantsJson ? FORCE_JSON_SUFFIX : "")
    : (KOREAN_STYLE_SUFFIX + (wantsJson ? FORCE_JSON_SUFFIX : ""));
  const out = messages.map((m) => ({ ...m }));
  const sysIdx = out.findIndex((m) => m.role === "system");
  if (sysIdx >= 0) {
    const cur = out[sysIdx];
    const asText = typeof cur.content === "string" ? cur.content : flattenContent(cur.content);
    const withNoThink = asText.includes("/no_think") ? asText : `/no_think\n${asText}`;
    out[sysIdx] = { role: "system", content: withNoThink + suffix };
  } else {
    out.unshift({ role: "system", content: `/no_think\n${suffix.trim()}` });
  }
  return out;
}


function wrapNvidiaAsGemini(e: unknown): never {
  if (e instanceof GeminiError) throw e;
  if (e instanceof OpenAiChatError) {
    const code =
      e.code === "TIMEOUT" || e.code === "DISABLED"
        ? "SERVER_ERROR"
        : (e.code as GeminiError["code"]);
    throw new GeminiError(e.message, e.status, code);
  }
  if (e instanceof NvidiaChatError) {
    const code =
      e.code === "MODEL_NOT_FOUND" || e.code === "DISABLED" || e.code === "TIMEOUT"
        ? "SERVER_ERROR"
        : (e.code as GeminiError["code"]);
    throw new GeminiError(e.message, e.status, code);
  }
  throw new GeminiError(
    e instanceof Error ? e.message : "NVIDIA 네트워크 오류",
    500,
    "SERVER_ERROR",
  );
}

function toOaiResponse(content: string, usage?: OpenAiChatResultUsage): OAIResponse {
  return {
    choices: [
      {
        message: { role: "assistant", content },
        finish_reason: "stop",
      },
    ],
    usage: usage
      ? {
          prompt_tokens: usage.prompt_tokens || 0,
          completion_tokens: usage.completion_tokens || 0,
          total_tokens: usage.total_tokens || 0,
        }
      : undefined,
  };
}

type OpenAiChatResultUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

async function viaOpenAi(args: {
  messages: { role: "system" | "user" | "assistant"; content: string }[];
  temperature: number;
  maxTokens: number;
  wantsJson: boolean;
}): Promise<OAIResponse> {
  const result = await callOpenAiChat({
    messages: args.messages,
    temperature: args.temperature,
    max_tokens: args.maxTokens,
    json: args.wantsJson,
  });
  const content = args.wantsJson ? stripCodeFences(result.content) : result.content;
  return toOaiResponse(content, result.usage);
}

/**
 * Chat completion. OpenAI (gpt-4o-mini) first when the key is set.
 * NVIDIA NIM only if OpenAI is off or fails.
 */
export async function callGeminiChat(req: OAIRequest): Promise<OAIResponse> {
  const wantsJson = req.response_format?.type === "json_object";
  const imagePresent = hasImageInput(req.messages);
  const compact = !!req.compact;

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
  }

  const preparedMessages = injectSystemRules(req.messages, wantsJson, compact);
  const messages = preparedMessages.map((m) => ({
    role: m.role as "system" | "user" | "assistant",
    content: flattenContent(m.content),
  }));
  const temperature = typeof req.temperature === "number" ? req.temperature : 0;
  const maxTokens = typeof req.max_tokens === "number" ? req.max_tokens : 4096;
  const openaiOn = isOpenAiFallbackEnabled();
  const openaiFirst = preferOpenAiForDraft();

  const runNvidia = async (): Promise<OAIResponse> => {
    const result = await callNvidiaChat({
      messages,
      temperature,
      max_tokens: maxTokens,
      extraBody: { chat_template_kwargs: { enable_thinking: false } },
    });
    let rawContent = (result.content || "").trim();
    if (!rawContent && result.raw) {
      const msg = (result.raw as any)?.choices?.[0]?.message || {};
      const reasoning = String(msg.reasoning_content || msg.reasoning || "").trim();
      if (reasoning) {
        const extracted = reasoning.match(/[\[{][\s\S]*[\]}]/);
        rawContent = extracted ? extracted[0] : reasoning;
      }
    }
    const content = wantsJson ? stripCodeFences(rawContent) : rawContent;
    return toOaiResponse(content, result.usage);
  };

  if (openaiOn && openaiFirst) {
    try {
      return await viaOpenAi({ messages, temperature, maxTokens, wantsJson });
    } catch (oaErr) {
      console.warn("[gemini] OpenAI primary failed, NVIDIA last resort:", oaErr);
      try {
        return await runNvidia();
      } catch (nvErr) {
        wrapNvidiaAsGemini(oaErr);
      }
    }
  }

  try {
    return await runNvidia();
  } catch (e) {
    if (openaiOn) {
      try {
        console.warn("[gemini] NVIDIA failed, OpenAI fallback");
        return await viaOpenAi({ messages, temperature, maxTokens, wantsJson });
      } catch (oaErr) {
        wrapNvidiaAsGemini(oaErr);
      }
    }
    wrapNvidiaAsGemini(e);
  }
}

/**
 * Fetch-like wrapper for drop-in replacement of `fetch(AI_URL, ...)`.
 */
export async function geminiChatFetch(body: OAIRequest): Promise<Response> {
  try {
    const result = await callGeminiChat(body);
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    if (e instanceof GeminiError) {
      return new Response(JSON.stringify({ error: { message: e.message, code: e.code } }), {
        status: e.status,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: { message: msg } }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
}

/**
 * Stream chat text. OpenAI first (one-shot yield) when the key is set.
 * NVIDIA stream only if OpenAI is off or fails.
 */
export async function* streamGeminiChatText(req: OAIRequest): AsyncGenerator<string, void, unknown> {
  const wantsJson = req.response_format?.type === "json_object";
  const compact = !!req.compact;
  const preparedMessages = injectSystemRules(req.messages, wantsJson, compact);
  const messages = preparedMessages.map((m) => ({
    role: m.role as "system" | "user" | "assistant",
    content: flattenContent(m.content),
  }));
  const temperature = typeof req.temperature === "number" ? req.temperature : 0.35;
  const maxTokens = typeof req.max_tokens === "number" ? req.max_tokens : 4096;
  const openaiOn = isOpenAiFallbackEnabled();
  const openaiFirst = preferOpenAiForDraft();

  const yieldOpenAi = async function* () {
    const result = await callOpenAiChat({
      messages,
      temperature,
      max_tokens: maxTokens,
      json: wantsJson,
    });
    const content = wantsJson ? stripCodeFences(result.content) : result.content;
    if (content) yield content;
  };

  if (openaiOn && openaiFirst) {
    try {
      yield* yieldOpenAi();
      return;
    } catch (oaErr) {
      console.warn("[gemini stream] OpenAI primary failed, NVIDIA last resort:", oaErr);
    }
  }

  try {
    yield* streamNvidiaChatText({
      messages,
      temperature,
      max_tokens: maxTokens,
      extraBody: { chat_template_kwargs: { enable_thinking: false } },
    });
  } catch (e) {
    if (openaiOn) {
      try {
        console.warn("[gemini stream] NVIDIA failed, OpenAI fallback");
        yield* yieldOpenAi();
        return;
      } catch (oaErr) {
        wrapNvidiaAsGemini(oaErr);
      }
    }
    wrapNvidiaAsGemini(e);
  }
}
