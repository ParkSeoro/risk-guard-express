import { z } from 'zod';

// Max lengths for text fields
const MAX_SHORT_TEXT = 100;
const MAX_MEDIUM_TEXT = 500;
const MAX_LONG_TEXT = 2000;

// Valid app roles
const VALID_ROLES = ['master', 'project_admin', 'safety_manager', 'contractor', 'viewer', 'user'] as const;

// Valid grade values
const VALID_GRADES = ['상', '중', '하'] as const;

// Valid statuses
const VALID_ACCOUNT_STATUSES = ['pending', 'active', 'inactive'] as const;

// ── Profile ──────────────────────────────────────────────
export const profileSchema = z.object({
  display_name: z.string().trim().min(1, '이름을 입력해주세요').max(MAX_SHORT_TEXT, `이름은 ${MAX_SHORT_TEXT}자 이내로 입력해주세요`),
  company: z.string().trim().max(MAX_SHORT_TEXT, `소속은 ${MAX_SHORT_TEXT}자 이내로 입력해주세요`).optional().default(''),
  phone: z.string().trim().max(30, '연락처는 30자 이내로 입력해주세요').optional().default(''),
  position: z.string().trim().max(MAX_SHORT_TEXT, `직위는 ${MAX_SHORT_TEXT}자 이내로 입력해주세요`).optional().default(''),
});

// ── User Management ──────────────────────────────────────
export const companyUpdateSchema = z.string().trim().max(MAX_SHORT_TEXT, `소속은 ${MAX_SHORT_TEXT}자 이내로 입력해주세요`);

export const roleChangeSchema = z.enum(VALID_ROLES, {
  errorMap: () => ({ message: '유효하지 않은 역할입니다.' }),
});

export const accountStatusSchema = z.enum(VALID_ACCOUNT_STATUSES, {
  errorMap: () => ({ message: '유효하지 않은 상태입니다.' }),
});

// ── Risk Item Cell Edit ──────────────────────────────────
const riskItemTextField = z.string().trim().max(MAX_LONG_TEXT, `${MAX_LONG_TEXT}자 이내로 입력해주세요`);
const gradeField = z.enum(VALID_GRADES, {
  errorMap: () => ({ message: '유효하지 않은 등급입니다.' }),
});

const RISK_ITEM_TEXT_FIELDS = [
  'process', 'sub_task', 'hazard', 'hazard_situation',
  'existing_measure', 'improvement_measure', 'note',
  'department', 'assignee',
] as const;

const RISK_ITEM_GRADE_FIELDS = [
  'likelihood_grade', 'severity_grade', 'risk_grade',
  'improved_likelihood_grade', 'improved_severity_grade', 'improved_risk_grade',
] as const;

const RISK_ITEM_NUMBER_FIELDS = [
  'frequency', 'severity', 'improved_frequency', 'improved_severity',
  'sort_order',
] as const;

/**
 * Validate a single risk item field value.
 * Returns { success: true, data } or { success: false, error: string }.
 */
export function validateRiskItemField(field: string, value: unknown): { success: true; data: unknown } | { success: false; error: string } {
  if ((RISK_ITEM_TEXT_FIELDS as readonly string[]).includes(field)) {
    const result = riskItemTextField.safeParse(value);
    return result.success ? { success: true, data: result.data } : { success: false, error: result.error.errors[0]?.message || '유효하지 않은 입력입니다.' };
  }
  if ((RISK_ITEM_GRADE_FIELDS as readonly string[]).includes(field)) {
    const result = gradeField.safeParse(value);
    return result.success ? { success: true, data: result.data } : { success: false, error: result.error.errors[0]?.message || '유효하지 않은 등급입니다.' };
  }
  if ((RISK_ITEM_NUMBER_FIELDS as readonly string[]).includes(field)) {
    const result = z.number().int().min(0).max(100).safeParse(value);
    return result.success ? { success: true, data: result.data } : { success: false, error: '유효하지 않은 숫자입니다.' };
  }
  if (field === 'is_locked') {
    const result = z.boolean().safeParse(value);
    return result.success ? { success: true, data: result.data } : { success: false, error: '유효하지 않은 값입니다.' };
  }
  if (field === 'ppe' || field === 'legal_basis') {
    const result = z.array(z.string().max(MAX_SHORT_TEXT)).max(50).safeParse(value);
    return result.success ? { success: true, data: result.data } : { success: false, error: '유효하지 않은 배열입니다.' };
  }
  // Unknown field - reject
  return { success: false, error: `알 수 없는 필드입니다: ${field}` };
}
