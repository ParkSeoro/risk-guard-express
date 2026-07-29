/**
 * 공통 Zod 스키마 라이브러리
 * 모든 페이지가 동일한 검증 규칙을 사용하도록 중앙화.
 * 사용 예: import { koreanName, phoneKR } from "@/lib/commonSchemas";
 */
import { z } from "zod";
export { jobTypeSchema, jobTypeOptionalSchema, isStandardJobType } from "@/lib/jobCategories";
export { zoneCategorySchema, isZoneCategory, DEFAULT_ZONE_CATEGORY } from "@/lib/tracking/accessRules";
export type { ZoneCategory } from "@/lib/tracking/accessRules";

/** 한글 이름: 2~30자, 공백 트림. 빈 문자열 거부. */
export const koreanName = z
  .string()
  .trim()
  .min(2, { message: "이름은 2자 이상이어야 합니다" })
  .max(30, { message: "이름은 30자 이하여야 합니다" });

/** 한국 휴대전화: 010-0000-0000 또는 01000000000 허용. 선택값. */
export const phoneKR = z
  .string()
  .trim()
  .regex(/^(01[016789])-?\d{3,4}-?\d{4}$/, { message: "올바른 휴대전화 번호를 입력하세요" });

export const phoneKROptional = phoneKR.optional().or(z.literal(""));

/** 일반 짧은 텍스트 (제목/라벨 등) */
export const shortText = z
  .string()
  .trim()
  .min(1, { message: "내용을 입력하세요" })
  .max(255, { message: "255자 이하로 입력하세요" });

/** 긴 설명/노트: 최대 5000자 */
export const longText = z
  .string()
  .trim()
  .max(5000, { message: "5000자 이하로 입력하세요" });

/** 이메일 */
export const emailField = z
  .string()
  .trim()
  .email({ message: "올바른 이메일을 입력하세요" })
  .max(255);

/** URL (선택) */
export const urlOptional = z
  .string()
  .trim()
  .url({ message: "올바른 URL을 입력하세요" })
  .max(2000)
  .optional()
  .or(z.literal(""));

/** UUID */
export const uuid = z.string().uuid({ message: "올바른 ID 형식이 아닙니다" });

/** 정수 (음수 불허) */
export const nonNegInt = z
  .number({ invalid_type_error: "숫자를 입력하세요" })
  .int()
  .min(0);

/** 안전한 파일명 (경로 우회 차단) */
export const safeFileName = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[^/\\\0]+$/, { message: "파일명에 / \\ 등은 포함할 수 없습니다" });

/**
 * Zod 결과를 toast 친화적 메시지로 변환
 */
export function zodErrorMessage(err: z.ZodError): string {
  return err.errors.map((e) => e.message).join("\n");
}
