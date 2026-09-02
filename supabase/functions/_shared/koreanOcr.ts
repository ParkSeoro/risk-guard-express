/**
 * 한글 문서 OCR — Gemini 비전을 먼저 쓰고, 키 실패·비전 오류면 OpenAI 비전으로 폴백한다.
 * NVIDIA 텍스트 모델로는 이미지를 보내지 않는다.
 */

import { callOpenAiChat, isOpenAiFallbackEnabled } from "./openaiChat.ts";

export const OCR_STATUS_LABEL = {
  ocr_raw: 'OCR 원문입니다. 숫자·상호를 원본과 대조하세요.',
  ocr_low: 'OCR 신뢰도가 낮습니다. 원본 증빙을 확인하세요.',
  ai_corrected: 'AI가 OCR 결과를 보정했습니다. 원본과 다른 칸을 확인하세요.',
  rule_fallback: '규칙 기반 예비 추출입니다. 거래날짜·공급자·세액을 확인하세요.',
  user_edited: '사용자가 OCR 결과를 직접 수정했습니다.',
  no_vision: '이미지 판독을 건너뛰었습니다. 엑셀이 아니면 항목이 비었을 수 있습니다.',
} as const;

export type KoreanOcrStatus = 'ocr_raw' | 'ocr_low' | 'ai_corrected' | 'rule_fallback' | 'user_edited' | 'no_vision';

export type KoreanOcrResult = {
  ok: boolean;
  status: KoreanOcrStatus;
  text: string;
  confidence: number | null;
  engine: string;
  warning?: string;
};

const GEMINI_OCR_MODEL = 'gemini-2.5-flash';
const LOW = 0.7;

const OCR_PROMPT = `이것은 대한민국 건설현장 산업안전보건관리비 증빙(거래명세서·세금계산서·영수증·사용내역서)입니다.
이미지/PDF에서 보이는 한글·숫자·표 내용을 읽기 순서대로 모두 옮기세요. 금액을 지어내지 마세요.
읽기 어려운 칸은 [불명]으로 표시하세요.
JSON만 반환: {"text":"전체 원문","confidence":0.0~1.0,"notes":"흐림·기울어짐·도장 가림 등"}`;

export function mergeOcrWarnings(...parts: Array<string | undefined | null>): string {
  const cleaned = parts.map((p) => String(p || "").trim()).filter(Boolean);
  const uniq: string[] = [];
  for (const part of cleaned) {
    if (uniq.some((u) => u.includes(part))) continue;
    const wider = uniq.findIndex((u) => part.includes(u));
    if (wider >= 0) {
      uniq[wider] = part;
      continue;
    }
    uniq.push(part);
  }
  return uniq.join(" · ");
}

export function publicOcrFailureWarning(raw: string): string {
  const msg = String(raw || "").trim();
  if (!msg) return OCR_STATUS_LABEL.no_vision;
  if (/API key not valid|API_KEY_INVALID|INVALID_API_KEY|INVALID_KEY|유효하지 않/i.test(msg)) {
    return `${OCR_STATUS_LABEL.no_vision} 이미지 판독 키가 만료되었거나 잘못되었습니다.`;
  }
  const short = msg.replace(/\s+/g, " ").slice(0, 160);
  if (!/[\uAC00-\uD7A3]/.test(short)) return OCR_STATUS_LABEL.no_vision;
  if (short.includes(OCR_STATUS_LABEL.no_vision)) return short;
  return `${OCR_STATUS_LABEL.no_vision} (${short})`;
}

function estimateConfidence(text: string, modelConfidence?: number | null) {
  const raw = String(text || '');
  const hangul = (raw.match(/[\uAC00-\uD7A3]/g) || []).length;
  const digits = (raw.match(/\d/g) || []).length;
  let c = typeof modelConfidence === 'number' && Number.isFinite(modelConfidence)
    ? Math.min(1, Math.max(0, modelConfidence))
    : 0.75;
  if (raw.trim().length < 20) c = Math.min(c, 0.35);
  if (hangul < 8 && raw.length > 40) c = Math.min(c, 0.45);
  if (digits < 2 && raw.length > 30) c = Math.min(c, 0.5);
  return Math.round(c * 100) / 100;
}

function parseOcrJson(raw: string): { text: string; confidence: number | null } {
  const cleaned = String(raw || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    return {
      text: String(obj.text || obj.transcript || obj.content || ''),
      confidence: obj.confidence != null ? Number(obj.confidence) : null,
    };
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        const obj = JSON.parse(match[0]);
        return {
          text: String(obj.text || ''),
          confidence: obj.confidence != null ? Number(obj.confidence) : null,
        };
      } catch { /* fall through */ }
    }
    return { text: cleaned, confidence: null };
  }
}

function isVisionMime(mime?: string) {
  const m = String(mime || '').toLowerCase();
  return m.startsWith('image/') || m === 'application/pdf';
}

function visionSuccess(
  text: string,
  aux: string,
  confidenceRaw: number | null,
  engine: string,
): KoreanOcrResult | null {
  const merged = [text, aux].filter((s) => s && s.trim()).join('\n\n');
  if (!merged.trim()) return null;
  const confidence = estimateConfidence(merged, confidenceRaw);
  const status: KoreanOcrStatus = confidence < LOW ? 'ocr_low' : 'ocr_raw';
  return {
    ok: true,
    status,
    text: merged,
    confidence,
    engine,
    warning: status === 'ocr_low' ? OCR_STATUS_LABEL.ocr_low : undefined,
  };
}

async function callGeminiVision(opts: {
  apiKey: string;
  mimeType: string;
  base64: string;
  hint: string;
}): Promise<{ text: string; confidence: number | null }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_OCR_MODEL}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
  const prompt = `${OCR_PROMPT}
보조 힌트:
${opts.hint.slice(0, 4000)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inline_data: { mime_type: opts.mimeType, data: opts.base64 } },
        ],
      }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error?.message || `Gemini OCR HTTP ${res.status}`;
    throw new Error(msg);
  }
  const parts = body?.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p: { text?: string }) => p.text || '').join('\n');
  return parseOcrJson(text);
}

async function callOpenAiVision(opts: {
  mimeType: string;
  base64: string;
  hint: string;
}): Promise<{ text: string; confidence: number | null }> {
  const mime = String(opts.mimeType || 'image/jpeg').toLowerCase();
  const dataUrl = `data:${mime};base64,${opts.base64}`;
  const prompt = `${OCR_PROMPT}
보조 힌트:
${opts.hint.slice(0, 4000)}`;

  const userContent = mime === 'application/pdf'
    ? [
      { type: 'text' as const, text: prompt },
      { type: 'file' as const, file: { filename: 'statement.pdf', file_data: dataUrl } },
    ]
    : [
      { type: 'text' as const, text: prompt },
      { type: 'image_url' as const, image_url: { url: dataUrl } },
    ];

  const result = await callOpenAiChat({
    messages: [
      { role: 'system', content: '문서에서 보이는 한글·숫자만 JSON으로 옮긴다. 없는 금액을 만들지 마라.' },
      { role: 'user', content: userContent },
    ],
    temperature: 0.1,
    max_tokens: 8192,
    json: true,
    timeoutMs: 90_000,
  });
  return parseOcrJson(result.content);
}

export async function runKoreanOcr(opts: {
  text?: string;
  fileBase64?: string;
  mimeType?: string;
  geminiKey?: string | null;
}): Promise<KoreanOcrResult> {
  const aux = String(opts.text || '').trim();
  const hasFile = Boolean(opts.fileBase64 && opts.mimeType);
  const vision = hasFile && isVisionMime(opts.mimeType);

  if (!vision) {
    if (!aux) {
      return {
        ok: false,
        status: 'no_vision',
        text: '',
        confidence: null,
        engine: 'none',
        warning: OCR_STATUS_LABEL.no_vision,
      };
    }
    return {
      ok: true,
      status: 'ocr_raw',
      text: aux,
      confidence: 0.9,
      engine: 'text',
    };
  }

  const errors: string[] = [];

  if (opts.geminiKey) {
    try {
      const visionOut = await callGeminiVision({
        apiKey: opts.geminiKey,
        mimeType: String(opts.mimeType),
        base64: String(opts.fileBase64),
        hint: aux,
      });
      const ok = visionSuccess(visionOut.text, aux, visionOut.confidence, 'gemini-2.5-flash');
      if (ok) return ok;
      errors.push('Gemini 비전이 빈 원문을 반환했습니다.');
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      console.warn('[koreanOcr] Gemini vision failed, trying OpenAI:', errors[errors.length - 1]);
    }
  }

  if (isOpenAiFallbackEnabled()) {
    try {
      const visionOut = await callOpenAiVision({
        mimeType: String(opts.mimeType),
        base64: String(opts.fileBase64),
        hint: aux,
      });
      const ok = visionSuccess(visionOut.text, aux, visionOut.confidence, 'gpt-4o-mini');
      if (ok) return ok;
      errors.push('OpenAI 비전이 빈 원문을 반환했습니다.');
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
      console.warn('[koreanOcr] OpenAI vision failed:', errors[errors.length - 1]);
    }
  }

  return {
    ok: false,
    status: 'no_vision',
    text: aux,
    confidence: null,
    engine: errors.length ? 'vision-failed' : 'none',
    warning: publicOcrFailureWarning(errors[0] || ''),
  };
}

export async function geminiJsonFromText(opts: {
  apiKey: string;
  system: string;
  prompt: string;
}): Promise<string> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_OCR_MODEL}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${opts.system}\n\n${opts.prompt}` }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
      },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message || `Gemini HTTP ${res.status}`);
  const parts = body?.candidates?.[0]?.content?.parts || [];
  return parts.map((p: { text?: string }) => p.text || '').join('\n');
}

const STATUS_SET = new Set<string>(Object.keys(OCR_STATUS_LABEL));

export function stampStructuredItem(
  item: Record<string, unknown>,
  ctx: {
    rawText: string;
    confidence: number | null;
    noVision?: boolean;
    ruleFallback?: boolean;
  },
) {
  const fieldsCorrected = item.fields_corrected === true || item.fieldsCorrected === true;
  const existing = typeof item.ocr_status === 'string' ? item.ocr_status : '';
  let status: KoreanOcrStatus = 'ocr_raw';
  if (existing === 'user_edited') status = 'user_edited';
  else if (ctx.noVision || existing === 'no_vision') status = 'no_vision';
  else if (ctx.ruleFallback || existing === 'rule_fallback') status = 'rule_fallback';
  else if ((ctx.confidence != null && ctx.confidence < LOW) || existing === 'ocr_low') status = 'ocr_low';
  else if (fieldsCorrected || existing === 'ai_corrected') status = 'ai_corrected';
  else if (STATUS_SET.has(existing)) status = existing as KoreanOcrStatus;

  const rest = { ...item };
  delete rest.fields_corrected;
  delete rest.fieldsCorrected;
  return {
    ...rest,
    ocr_status: status,
    ocr_confidence: ctx.confidence,
    ocr_raw_text: String(item.ocr_raw_text || ctx.rawText || '').slice(0, 2000),
  };
}
