/**
 * 현장 근로자 전화번호 기반 간편 Auth.
 * Supabase Email/Password에 가상 이메일(`{phone}@worker.local`)을 태운다.
 */
import { z } from "zod";

export const WORKER_EMAIL_DOMAIN = "worker.local";

/** 숫자만 추출 (마스킹/입력 정규화) */
export function digitsOnlyPhone(input: string | null | undefined): string {
  return String(input || "").replace(/\D/g, "");
}

/**
 * 표시용 마스킹: 010-1234-5678
 * 입력 중에도 숫자만 반영해 하이픈을 붙인다.
 */
export function formatPhoneMask(input: string | null | undefined): string {
  const d = digitsOnlyPhone(input).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 7) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
}

/** Auth용 정규화 전화번호 (하이픈 없는 숫자만, 10~11자리) */
export function normalizeWorkerPhone(input: string | null | undefined): string {
  return digitsOnlyPhone(input);
}

/** 전화번호를 가상 이메일로 변환 — Auth signUp/signIn 키 */
export function phoneToWorkerEmail(phone: string | null | undefined): string {
  const digits = normalizeWorkerPhone(phone);
  return `${digits}@${WORKER_EMAIL_DOMAIN}`;
}

export function isWorkerVirtualEmail(email: string | null | undefined): boolean {
  const e = String(email || "").trim().toLowerCase();
  return e.endsWith(`@${WORKER_EMAIL_DOMAIN}`);
}

/** 근로자 PIN: 숫자 4~6자리 */
export const workerPinSchema = z
  .string({ required_error: "PIN 번호를 입력하세요" })
  .regex(/^\d{4,6}$/, { message: "비밀번호는 숫자 4~6자리여야 합니다" });

/** 근로자 가입/로그인용 휴대전화 */
export const workerPhoneSchema = z
  .string({ required_error: "전화번호를 입력하세요" })
  .transform((v) => digitsOnlyPhone(v))
  .refine((v) => /^01[016789]\d{7,8}$/.test(v), {
    message: "올바른 휴대전화 번호를 입력하세요",
  });
