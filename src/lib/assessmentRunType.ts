export const ASSESSMENT_RUN_TYPES = ['최초', '정기', '수시', '상시'] as const;

export type AssessmentRunType = (typeof ASSESSMENT_RUN_TYPES)[number];

export const ASSESSMENT_RUN_TYPE_LABELS: Record<AssessmentRunType, string> = {
  최초: '최초평가',
  정기: '정기평가',
  수시: '수시평가',
  상시: '상시평가',
};

export type AssessmentRunCreateForm = {
  type: AssessmentRunType;
  period_label: string;
  start_date: string;
  end_date: string;
  target_processes: string;
  target_company_ids: string[];
  notes: string;
  author_user_id: string;
};

export function isAssessmentRunType(value: string | null | undefined): value is AssessmentRunType {
  return !!value && (ASSESSMENT_RUN_TYPES as readonly string[]).includes(value);
}

/** List filter `all` and unknown values fall back to 정기. */
export function resolveAssessmentRunType(
  value: string | null | undefined,
  fallback: AssessmentRunType = '정기',
): AssessmentRunType {
  if (value && value !== 'all' && isAssessmentRunType(value)) return value;
  return fallback;
}

export function formatAssessmentRunTypeTag(value: string | null | undefined): string {
  const type = resolveAssessmentRunType(value);
  return ASSESSMENT_RUN_TYPE_LABELS[type];
}

export function periodLabelPlaceholder(type: AssessmentRunType): string {
  if (type === '수시') return '예: 수시 · 공정변경 (2026-08-19)';
  if (type === '상시') return '예: 2026년 8월 상시';
  if (type === '최초') return '예: 최초평가';
  return '예: 2026년 8월 4주차';
}

export function emptyAssessmentRunCreateForm(
  type?: string | null,
  authorUserId?: string | null,
): AssessmentRunCreateForm {
  return {
    type: resolveAssessmentRunType(type),
    period_label: '',
    start_date: '',
    end_date: '',
    target_processes: '',
    target_company_ids: [],
    notes: '',
    author_user_id: authorUserId || '',
  };
}

export function buildAssessmentRunCreatePayload(args: {
  projectId: string;
  userId: string;
  form: AssessmentRunCreateForm;
  contractorNames: string[];
}) {
  return {
    project_id: args.projectId,
    type: resolveAssessmentRunType(args.form.type),
    period_label: args.form.period_label.trim(),
    start_date: args.form.start_date || null,
    end_date: args.form.end_date || null,
    target_processes: args.form.target_processes.split(',').map((s) => s.trim()).filter(Boolean),
    target_contractors: args.contractorNames,
    target_company_ids: args.form.target_company_ids,
    notes: args.form.notes.trim(),
    status: '작성중',
    created_by: args.userId,
    author_user_id: args.form.author_user_id || null,
  };
}
