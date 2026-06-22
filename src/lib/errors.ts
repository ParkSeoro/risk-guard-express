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
  "42501": { kind: "permission", message: "권한이 없어 접근이 거부되었습니다." },
};

export function normalizeError(err: unknown): NormalizedError {
  if (!err) return { message: "알 수 없는 오류가 발생했습니다.", kind: "unknown" };

  // Zod
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const path = first?.path?.join(".");
    return {
      kind: "validation",
      message: path ? `${path}: ${first?.message}` : first?.message || "입력값 검증 실패",
      raw: err.issues,
    };
  }

  const e: any = err;

  // Supabase error
  if (e?.code && PG_CODE_MAP[e.code]) {
    return { ...PG_CODE_MAP[e.code], raw: err };
  }

  const msg: string = e?.message || String(err);

  if (/row-level security|RLS/i.test(msg)) {
    return { kind: "permission", message: "이 데이터에 접근할 권한이 없습니다. 프로젝트 관리자에게 문의하세요.", raw: err };
  }
  if (/not.found|NotFound/i.test(msg)) {
    return { kind: "notfound", message: "데이터를 찾을 수 없습니다.", raw: err };
  }
  if (/network|fetch failed|TypeError.*fetch/i.test(msg)) {
    return { kind: "network", message: "네트워크 오류 — 잠시 후 다시 시도해주세요.", raw: err };
  }
  if (/duplicate|unique/i.test(msg)) {
    return { kind: "conflict", message: "중복된 값이 있어 저장하지 못했습니다.", raw: err };
  }
  if (/permission|denied|forbidden/i.test(msg)) {
    return { kind: "permission", message: "권한이 없습니다.", raw: err };
  }
  if (/jwt|token|expired/i.test(msg)) {
    return { kind: "permission", message: "로그인 세션이 만료되었습니다. 다시 로그인해주세요.", raw: err };
  }

  return { kind: "unknown", message: msg || "처리 중 오류가 발생했습니다.", raw: err };
}
