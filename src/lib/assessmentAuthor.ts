/** 고시 §7 작성 주체 = 관리감독자. created_by 는 입력자(보좌 가능). */

export const ASSESSMENT_LEGAL_AUTHOR_ROLE = 'site_supervisor' as const;

export const ASSESSMENT_ASSIST_WRITE_ROLES = [
  'safety_manager',
  'project_admin',
  'site_manager',
] as const;

export type AssessmentAuthorCandidate = {
  user_id: string;
  display_name: string;
  company_id: string | null;
  company_name: string;
};

export function isSiteSupervisorRole(role?: string | null): boolean {
  return role === ASSESSMENT_LEGAL_AUTHOR_ROLE;
}

export function canAssistAssessmentWrite(role?: string | null, isMaster = false): boolean {
  if (isMaster) return true;
  return !!role && (ASSESSMENT_ASSIST_WRITE_ROLES as readonly string[]).includes(role);
}

export function canCreateAssessmentRun(role?: string | null, isMaster = false): boolean {
  return isMaster
    || isSiteSupervisorRole(role)
    || role === 'safety_manager'
    || role === 'project_admin';
}

export function defaultAuthorUserId(opts: { userId?: string | null; role?: string | null }): string {
  if (opts.userId && isSiteSupervisorRole(opts.role)) return opts.userId;
  return '';
}

export function hasAssessmentLegalAuthor(authorUserId?: string | null): boolean {
  return !!authorUserId;
}

/** 상신은 지정된 관리감독자만. 마스터/SM 명의 상신 불가. */
export function canSubmitAssessmentRun(opts: {
  userId?: string | null;
  authorUserId?: string | null;
}): boolean {
  if (!opts.userId || !opts.authorUserId) return false;
  return opts.userId === opts.authorUserId;
}

export function assessmentAuthorSubmitMessage(opts: {
  authorUserId?: string | null;
  authorName?: string | null;
  userId?: string | null;
}): string | null {
  if (!hasAssessmentLegalAuthor(opts.authorUserId)) {
    return '작성 주체(관리감독자)를 지정하세요. 상신·인쇄는 지정 후에만 가능합니다.';
  }
  if (!canSubmitAssessmentRun({ userId: opts.userId, authorUserId: opts.authorUserId })) {
    const who = opts.authorName?.trim() || '지정된 관리감독자';
    return `상신은 작성 관리감독자(${who})만 할 수 있습니다.`;
  }
  return null;
}

export function formatAssessmentAuthorLabel(candidate?: AssessmentAuthorCandidate | null): string {
  if (!candidate) return '';
  const company = candidate.company_name?.trim();
  return company ? `${candidate.display_name} · ${company}` : candidate.display_name;
}

export function pickAuthorCandidate(
  candidates: AssessmentAuthorCandidate[],
  authorUserId?: string | null,
): AssessmentAuthorCandidate | null {
  if (!authorUserId) return null;
  return candidates.find((c) => c.user_id === authorUserId) || null;
}
