/**
 * 현장 근로자 전화번호 기반 간편 Auth.
 * Supabase Email/Password에 가상 이메일(`{phone}@worker.local`)을 태운다.
 */
import { z } from "zod";
import type { AuthError, Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

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

export type WorkerSignInResult = {
  data: { user: User | null; session: Session | null };
  error: AuthError | null;
  /** 변환에 사용된 가상 이메일 (디버그/로그용) */
  loginEmail: string;
};

/**
 * 근로자 간편 로그인: 전화번호 → `{digits}@worker.local` 랩핑 후 signInWithPassword.
 */
export async function signInWorkerWithPhone(
  phoneInput: string,
  pinPassword: string,
): Promise<WorkerSignInResult> {
  const phoneParsed = workerPhoneSchema.safeParse(phoneInput);
  if (!phoneParsed.success) {
    return {
      data: { user: null, session: null },
      error: {
        name: "AuthApiError",
        message: phoneParsed.error.errors[0]?.message || "전화번호가 올바르지 않습니다",
        status: 400,
      } as AuthError,
      loginEmail: "",
    };
  }
  const pinParsed = workerPinSchema.safeParse(pinPassword);
  if (!pinParsed.success) {
    return {
      data: { user: null, session: null },
      error: {
        name: "AuthApiError",
        message: pinParsed.error.errors[0]?.message || "PIN이 올바르지 않습니다",
        status: 400,
      } as AuthError,
      loginEmail: "",
    };
  }

  const loginEmail = phoneToWorkerEmail(phoneParsed.data);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: loginEmail,
    password: pinParsed.data,
  });
  return { data, error, loginEmail };
}
