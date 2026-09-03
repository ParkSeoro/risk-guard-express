/** 작업계획서 작성 주체 = 관리감독자. created_by 는 입력자(보좌 가능). 상신은 잠그지 않는다. */

import { hasAssessmentLegalAuthor } from '@/lib/assessmentAuthor';

export {
  ASSESSMENT_ASSIST_WRITE_ROLES as WORK_PLAN_ASSIST_WRITE_ROLES,
  ASSESSMENT_LEGAL_AUTHOR_ROLE as WORK_PLAN_LEGAL_AUTHOR_ROLE,
  canAssistAssessmentWrite as canAssistWorkPlanWrite,
  defaultAuthorUserId,
  formatAssessmentAuthorLabel,
  hasAssessmentLegalAuthor as hasWorkPlanLegalAuthor,
  isSiteSupervisorRole,
  pickAuthorCandidate,
  type AssessmentAuthorCandidate,
} from '@/lib/assessmentAuthor';

/** 지정만 필수. 누가 입력·상신하는지는 막지 않는다. 인쇄·PDF에 이 이름이 표시된다. */
export function workPlanAuthorDisplayMessage(authorUserId?: string | null): string | null {
  if (hasAssessmentLegalAuthor(authorUserId)) return null;
  return '작성 주체(관리감독자)를 지정하세요. 인쇄·PDF에 이 이름이 표시됩니다.';
}

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
