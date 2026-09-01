/**
 * NVIDIA NIM HTTP error classification (no Deno / fetch deps).
 * Shared by nvidiaChat.ts and Vitest.
 *
 * 410 Gone / "end of life" must failover — hosted NIM retires models
 * (Nemotron Super 49B EOL 2026-08-26) and returns 410, not 404.
 */

export type NvidiaHttpErrorCode =
  | "RATE_LIMIT"
  | "QUOTA_EXHAUSTED"
  | "INVALID_KEY"
  | "BAD_REQUEST"
  | "SERVER_ERROR"
  | "MODEL_NOT_FOUND";

export type NvidiaHttpClass = {
  message: string;
  status: number;
  code: NvidiaHttpErrorCode;
};

export function isRetiredModelText(text: string): boolean {
  return /end of life|\bgone\b|retired|no longer available|has been (removed|deprecated)|\beol\b/i
    .test(text || "");
}

export function isFailoverHttp(status: number, bodyText: string): boolean {
  if (status === 429 || status === 503 || status === 529) return true;
  if (status === 404 || status === 410) return true;
  if (status === 401 || status === 403) {
    if (/quota|exceed|exhausted|credit/i.test(bodyText)) return true;
  }
  if (status === 400 && /model|not found|does not exist|unknown model/i.test(bodyText)) {
    return true;
  }
  if (isRetiredModelText(bodyText)) return true;
  return false;
}

export function classifyNvidiaHttpError(
  status: number,
  text: string,
  model?: string,
): NvidiaHttpClass {
  if (status === 429) {
    return {
      message: "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
      status: 429,
      code: "RATE_LIMIT",
    };
  }
  if (status === 529 || status === 503) {
    return {
      message: "AI 서버가 일시적으로 과부하입니다. 잠시 후 다시 시도해주세요.",
      status,
      code: "RATE_LIMIT",
    };
  }
  if (
    status === 410 ||
    isRetiredModelText(text) ||
    status === 404 ||
    (status === 400 && /model|not found|does not exist|unknown model/i.test(text))
  ) {
    return {
      message: `NVIDIA 모델이 종료되었거나 찾을 수 없습니다: ${model || "?"} (${status})`,
      status: status === 400 ? 404 : status,
      code: "MODEL_NOT_FOUND",
    };
  }
  if (status === 401 || status === 403) {
    if (/quota|exceed|exhausted|credit/i.test(text)) {
      return {
        message: "NVIDIA API 할당량이 소진되었습니다. 사용량을 확인해주세요.",
        status: 402,
        code: "QUOTA_EXHAUSTED",
      };
    }
    return {
      message:
        "NVIDIA API 키가 유효하지 않습니다. NVIDIA_API_KEY(Supabase Edge Secrets)를 확인해주세요.",
      status: 403,
      code: "INVALID_KEY",
    };
  }
  if (status === 400) {
    return {
      message: `NVIDIA 요청 오류: ${text.slice(0, 200)}`,
      status: 400,
      code: "BAD_REQUEST",
    };
  }
  return {
    message: `NVIDIA AI 서버 오류 (${status})`,
    status,
    code: "SERVER_ERROR",
  };
}
