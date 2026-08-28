/**
 * 한글 문서 OCR — Gemini 비전을 직접 호출한다.
 * NVIDIA 텍스트 모델로는 이미지를 보내지 않는다.
 */

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

async function callGeminiVision(opts: {
  apiKey: string;
  mimeType: string;
  base64: string;
  hint: string;
}): Promise<{ text: string; confidence: number | null }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_OCR_MODEL}:generateContent?key=${encodeURIComponent(opts.apiKey)}`;
  const prompt = `이것은 대한민국 건설현장 산업안전보건관리비 증빙(거래명세서·세금계산서·영수증·사용내역서)입니다.
이미지/PDF에서 보이는 한글·숫자·표 내용을 읽기 순서대로 모두 옮기세요. 금액을 지어내지 마세요.
읽기 어려운 칸은 [불명]으로 표시하세요.
JSON만 반환: {"text":"전체 원문","confidence":0.0~1.0,"notes":"흐림·기울어짐·도장 가림 등"}
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

  if (!opts.geminiKey) {
    return {
      ok: false,
      status: 'no_vision',
      text: aux,
      confidence: null,
      engine: 'none',
      warning: OCR_STATUS_LABEL.no_vision,
    };
  }

  try {
    const visionOut = await callGeminiVision({
      apiKey: opts.geminiKey,
      mimeType: String(opts.mimeType),
      base64: String(opts.fileBase64),
      hint: aux,
    });
    const merged = [visionOut.text, aux].filter((s) => s && s.trim()).join('\n\n');
    if (!merged.trim()) {
      return {
        ok: false,
        status: 'no_vision',
        text: '',
        confidence: null,
        engine: 'gemini-2.5-flash',
        warning: OCR_STATUS_LABEL.no_vision,
      };
    }
    const confidence = estimateConfidence(merged, visionOut.confidence);
    const status: KoreanOcrStatus = confidence < LOW ? 'ocr_low' : 'ocr_raw';
    return {
      ok: true,
      status,
      text: merged,
      confidence,
      engine: 'gemini-2.5-flash',
      warning: status === 'ocr_low' ? OCR_STATUS_LABEL.ocr_low : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: 'no_vision',
      text: aux,
      confidence: null,
      engine: 'gemini-failed',
      warning: `${OCR_STATUS_LABEL.no_vision} (${msg})`,
    };
  }
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
