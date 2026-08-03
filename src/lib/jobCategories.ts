/**
 * 플랜트/건설 현장 표준 직종 SSOT.
 * 주관식·'기타' 없이 Select(객관식)만 허용한다.
 */
import { z } from "zod";

export const JOB_CATEGORIES = {
  "기계/배관/용접": ["용접공", "배관공", "제관공", "취부사", "보온공", "도장공", "비파괴검사원"],
  "전기/계장": ["전기공", "계장공", "케이블포설공", "통신공"],
  "골조/토목/건축": ["비계공", "철골공", "철근공", "형틀목수", "콘크리트타설공", "방수공", "판넬공"],
  "장비/공통": ["일반조공", "여공", "중장비운전원", "양중작업자"],
  "안전/감시/관리": ["화재감시자", "밀폐공간감시자", "신호수/유도수", "안전관리자", "관리감독자"],
} as const;

export type JobCategoryName = keyof typeof JOB_CATEGORIES;

type JobCategoryValues = (typeof JOB_CATEGORIES)[JobCategoryName];
export type StandardJobType = JobCategoryValues[number];

/** 카테고리 순서 유지한 평탄 표준 직종 목록 */
export const STANDARD_JOB_TYPES = (
  Object.values(JOB_CATEGORIES) as ReadonlyArray<ReadonlyArray<string>>
).flat() as StandardJobType[];

const STANDARD_JOB_TYPE_SET = new Set<string>(STANDARD_JOB_TYPES);

export function isStandardJobType(value: string | null | undefined): value is StandardJobType {
  return !!value && STANDARD_JOB_TYPE_SET.has(value);
}

/** Zod: 표준 직종만 허용 (주관식·기타 차단) */
export const jobTypeSchema = z
  .string({ required_error: "직종을 선택하세요" })
  .trim()
  .refine((v): v is StandardJobType => isStandardJobType(v), {
    message: "표준 직종 목록에서 선택하세요",
  });

export const jobTypeOptionalSchema = z
  .string()
  .trim()
  .optional()
  .or(z.literal(""))
  .refine((v) => !v || isStandardJobType(v), {
    message: "표준 직종 목록에서 선택하세요",
  });

/**
 * 법정교육 매핑 키(영문 코드)로 변환.
 * workers.job_type에는 한글 표준명을 저장하고, 교육 미리보기/시드용으로만 사용.
 */
const LEGAL_EDUCATION_JOB_TYPE_MAP: Record<StandardJobType, string> = {
  용접공: "welding",
  배관공: "general",
  제관공: "welding",
  취부사: "welding",
  보온공: "chemical",
  도장공: "chemical",
  비파괴검사원: "general",
  전기공: "electrical",
  계장공: "electrical",
  케이블포설공: "electrical",
  통신공: "electrical",
  비계공: "scaffold",
  철골공: "height",
  철근공: "formwork",
  형틀목수: "formwork",
  콘크리트타설공: "general",
  방수공: "general",
  판넬공: "height",
  일반조공: "general",
  여공: "general",
  중장비운전원: "heavy_equipment",
  양중작업자: "rigging",
  화재감시자: "hazardous",
  밀폐공간감시자: "confined",
  "신호수/유도수": "crane_signal",
  안전관리자: "safety_officer",
  관리감독자: "manager",
};

export function toLegalEducationJobType(jobType: string | null | undefined): string {
  if (!jobType?.trim()) return "general";
  const trimmed = jobType.trim();
  if (isStandardJobType(trimmed)) return LEGAL_EDUCATION_JOB_TYPE_MAP[trimmed];
  return trimmed;
}

export function jobCategoryEntries(): Array<[JobCategoryName, readonly StandardJobType[]]> {
  return Object.entries(JOB_CATEGORIES) as Array<[JobCategoryName, readonly StandardJobType[]]>;
}
