/** 작업계획서 작성 주체 = 관리감독자. created_by 는 입력자(보좌 가능). */

export {
  ASSESSMENT_ASSIST_WRITE_ROLES as WORK_PLAN_ASSIST_WRITE_ROLES,
  ASSESSMENT_LEGAL_AUTHOR_ROLE as WORK_PLAN_LEGAL_AUTHOR_ROLE,
  assessmentAuthorSubmitMessage as workPlanAuthorSubmitMessage,
  canAssistAssessmentWrite as canAssistWorkPlanWrite,
  canSubmitAssessmentRun as canSubmitWorkPlan,
  defaultAuthorUserId,
  formatAssessmentAuthorLabel,
  hasAssessmentLegalAuthor as hasWorkPlanLegalAuthor,
  isSiteSupervisorRole,
  pickAuthorCandidate,
  type AssessmentAuthorCandidate,
} from '@/lib/assessmentAuthor';

type OverviewSection = {
  key?: string;
  content?: string;
  [rest: string]: unknown;
};

/** Fill overview.supervisor only when it is empty. Does not copy RA author. */
export function prefillOverviewSupervisor<T extends OverviewSection>(
  sections: T[],
  supervisorName?: string | null,
): T[] {
  const name = supervisorName?.trim();
  if (!name) return sections;
  let changed = false;
  const next = sections.map((s) => {
    if (s.key !== 'overview') return s;
    let data: Record<string, unknown> = {};
    if (s.content) {
      try {
        const parsed = JSON.parse(s.content);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          data = parsed as Record<string, unknown>;
        } else {
          return s;
        }
      } catch {
        return s;
      }
    }
    if (String(data.supervisor || '').trim()) return s;
    changed = true;
    return { ...s, content: JSON.stringify({ ...data, supervisor: name }) };
  });
  return changed ? next : sections;
}
