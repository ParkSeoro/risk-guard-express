/**
 * ============================================================
 * errors.ts — 에러 메시지 한국어 변환 SSOT
 * ============================================================
 * Supabase/PostgREST/RLS/Zod 에러를 사용자에게 의미있는 한국어로 변환.
 * useToastError 와 함께 사용.
 */
import { ZodError } from "zod";

export interface NormalizedError {
  /** 사용자에게 보여줄 한국어 메시지 */
  message: string;
  /** 디버깅용 원본 정보 */
  raw?: unknown;
  /** UI 토스트 종류 결정용 */
  kind: "permission" | "validation" | "network" | "notfound" | "conflict" | "server" | "unknown";
}

const PG_CODE_MAP: Record<string, { kind: NormalizedError["kind"]; message: string }> = {
  "23505": { kind: "conflict", message: "이미 같은 값이 등록되어 있습니다. 중복 확인 후 다시 시도해주세요." },
  "23503": { kind: "conflict", message: "참조되고 있는 데이터입니다. 연결된 항목부터 정리해주세요." },
  "23502": { kind: "validation", message: "필수 항목이 비어 있습니다. 값을 입력해주세요." },
  "22P02": { kind: "validation", message: "값 형식이 올바르지 않습니다." },
  "PGRST301": { kind: "permission", message: "이 작업을 수행할 권한이 없습니다." },
  "PGRST116": { kind: "notfound", message: "해당 데이터를 찾을 수 없습니다." },
  "PGRST003": { kind: "server", message: "서버가 바빠 처리하지 못했습니다. 잠시 후 다시 시도해 주세요." },
  "42501": { kind: "permission", message: "권한이 없어 접근이 거부되었습니다." },
  "57014": { kind: "server", message: "처리 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요." },
};

const HANGUL = /[가-힣]/;
const GENERIC_KO = "처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";

/** 사용자에게 보이는 경고 문구. 한글은 유지하고, 영문 오류는 한글로 바꿉니다. */
export function toKoreanWarning(input: unknown): string {
  const raw = warningText(input).trim();
  if (!raw) return GENERIC_KO;

  if (/row-level security|violates row-level|\bRLS\b|\b42501\b/i.test(raw)) {
    return "이 내용을 저장할 권한이 없습니다. 관리자에게 문의하세요.";
  }
  if (/jwt|invalid claim|refresh token|session.*(expired|missing)|auth session missing/i.test(raw)) {
    return "로그인 세션이 만료되었습니다. 다시 로그인해 주세요.";
  }
  if (/duplicate key|unique constraint|already exists|\b23505\b/i.test(raw)) {
    return "이미 같은 내용이 등록되어 있습니다.";
  }
  if (/foreign key|\b23503\b/i.test(raw)) {
    return "연결된 항목이 있어 처리하지 못했습니다.";
  }
  if (/null value in column|\b23502\b/i.test(raw)) {
    return "필수 항목이 비어 있습니다.";
  }
  if (/failed to fetch|fetch failed|network|load failed|offline/i.test(raw)) {
    return "네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
  }
  if (/statement timeout|canceling statement|\b57014\b|\btimeout\b/i.test(raw)) {
    return "처리 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (/permission denied|not authorized|forbidden|\bPGRST301\b/i.test(raw)) {
    return "이 작업을 할 권한이 없습니다.";
  }
  if (/\bPGRST116\b/i.test(raw) || (!HANGUL.test(raw) && /\bnot found\b/i.test(raw))) {
    return "해당 내용을 찾을 수 없습니다.";
  }
  if (/\bPGRST003\b/i.test(raw)) {
    return "서버가 바빠 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }

  if (HANGUL.test(raw)) {
    if (/[A-Za-z]{6,}/.test(raw) && /error|fail|violat|denied|exception|invalid|policy/i.test(raw)) {
      const head = raw.split(/[:：]/)[0]?.trim() ?? "";
      if (HANGUL.test(head) && head.length < raw.length) return `${head}. ${GENERIC_KO}`;
      return GENERIC_KO;
    }
    return raw;
  }

  return GENERIC_KO;
}

function warningText(input: unknown): string {
  if (input == null) return "";
  if (typeof input === "string") return input;
  if (input instanceof Error) return input.message;
  if (typeof input === "object" && "message" in input && typeof (input as { message: unknown }).message === "string") {
    return (input as { message: string }).message;
  }
  return "";
}

export function normalizeError(err: unknown): NormalizedError {
  if (!err) return { message: "알 수 없는 오류가 발생했습니다.", kind: "unknown" };

  // Zod
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const path = first?.path?.join(".");
    const detail = path ? `${path}: ${first?.message}` : first?.message || "입력값 검증 실패";
    return {
      kind: "validation",
      message: toKoreanWarning(detail),
      raw: err.issues,
    };
  }

  const e: any = err;

  // Supabase error
  if (e?.code && PG_CODE_MAP[e.code]) {
    return { ...PG_CODE_MAP[e.code], raw: err };
  }

  const msg: string = e?.message || (typeof err === "string" ? err : "");
  const message = toKoreanWarning(msg || err);
  let kind: NormalizedError["kind"] = "unknown";
  if (/row-level security|violates row-level|\b42501\b|permission denied|not authorized|forbidden|jwt|refresh token|PGRST301/i.test(msg)) {
    kind = "permission";
  } else if (/\bPGRST116\b|\bnot found\b/i.test(msg)) {
    kind = "notfound";
  } else if (/failed to fetch|fetch failed|network|offline/i.test(msg)) {
    kind = "network";
  } else if (/duplicate key|unique constraint|already exists|\b23505\b/i.test(msg)) {
    kind = "conflict";
  } else if (/null value in column|\b23502\b|\b22P02\b/i.test(msg)) {
    kind = "validation";
  } else if (/timeout|\b57014\b|\bPGRST003\b/i.test(msg)) {
    kind = "server";
  }
  return { kind, message, raw: err };
}
