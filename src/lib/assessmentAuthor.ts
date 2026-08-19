/** 작성 주체 = 관리감독자 또는 현장소장. created_by 는 입력자(보좌 가능). */

export const ASSESSMENT_LEGAL_AUTHOR_ROLES = ['site_supervisor', 'site_manager'] as const;

export type AssessmentLegalAuthorRole = (typeof ASSESSMENT_LEGAL_AUTHOR_ROLES)[number];

export const ASSESSMENT_ASSIST_WRITE_ROLES = [
  'safety_manager',
  'project_admin',
] as const;

export const ASSESSMENT_LEGAL_AUTHOR_LABEL = '관리감독자·현장소장';

const ROLE_TITLE: Record<string, string> = {
  site_supervisor: '관리감독자',
  site_manager: '현장소장',
};

export type AssessmentAuthorCandidate = {
  user_id: string;
  display_name: string;
  company_id: string | null;
  company_name: string;
  role?: string | null;
};

export function isAssessmentLegalAuthorRole(role?: string | null): boolean {
  return !!role && (ASSESSMENT_LEGAL_AUTHOR_ROLES as readonly string[]).includes(role);
}

export function isAssessmentLegalAuthorPosition(position?: string | null): boolean {
  const p = (position || '').toUpperCase();
  return p === 'SITE_MANAGER' || p === 'SITE_SUPERVISOR';
}

/** 역할 또는 직책이 작성 주체이면 true (role/position drift 허용). */
export function isAssessmentLegalAuthorMember(row: {
  role_new?: string | null;
  role?: string | null;
  position_new?: string | null;
  position?: string | null;
}): boolean {
  return isAssessmentLegalAuthorRole(row.role_new || row.role)
    || isAssessmentLegalAuthorPosition(row.position_new || row.position);
}

export function resolveAuthorRoleLabel(row: {
  role?: string | null;
  position?: string | null;
}): string {
  if (row.role === 'site_manager' || (row.position || '').toUpperCase() === 'SITE_MANAGER') {
    return 'site_manager';
  }
  if (row.role === 'site_supervisor' || (row.position || '').toUpperCase() === 'SITE_SUPERVISOR') {
    return 'site_supervisor';
  }
  return row.role || '';
}

export function buildAuthorCandidates(rows: Array<{
  user_id?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  display_name?: string | null;
  role_new?: string | null;
  role?: string | null;
  position_new?: string | null;
  position?: string | null;
}>): AssessmentAuthorCandidate[] {
  const seen = new Set<string>();
  const next: AssessmentAuthorCandidate[] = [];
  for (const row of rows) {
    if (!row.user_id || seen.has(row.user_id)) continue;
    if (!isAssessmentLegalAuthorMember(row)) continue;
    seen.add(row.user_id);
    next.push({
      user_id: row.user_id,
      display_name: (row.display_name || '').trim() || row.user_id.slice(0, 8),
      company_id: row.company_id || null,
      company_name: row.company_name || '',
      role: resolveAuthorRoleLabel({
        role: row.role_new || row.role,
        position: row.position_new || row.position,
      }),
    });
  }
  next.sort((a, b) => {
    const rank = (r?: string | null) => (r === 'site_manager' ? 0 : 1);
    const d = rank(a.role) - rank(b.role);
    if (d !== 0) return d;
    return a.display_name.localeCompare(b.display_name, 'ko');
  });
  return next;
}

export function isSiteSupervisorRole(role?: string | null): boolean {
  return role === 'site_supervisor';
}

export function canAssistAssessmentWrite(role?: string | null, isMaster = false): boolean {
  if (isMaster) return true;
  return !!role && (ASSESSMENT_ASSIST_WRITE_ROLES as readonly string[]).includes(role);
}

export function canCreateAssessmentRun(role?: string | null, isMaster = false): boolean {
  return isMaster
    || isAssessmentLegalAuthorRole(role)
    || role === 'safety_manager'
    || role === 'project_admin';
}

export function defaultAuthorUserId(opts: { userId?: string | null; role?: string | null }): string {
  if (opts.userId && isAssessmentLegalAuthorRole(opts.role)) return opts.userId;
  return '';
}

export function hasAssessmentLegalAuthor(authorUserId?: string | null): boolean {
  return !!authorUserId;
}

/** 상신은 지정된 작성 주체만. 마스터/SM 명의 상신 불가. */
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
    return `작성 주체(${ASSESSMENT_LEGAL_AUTHOR_LABEL})를 지정하세요. 상신·인쇄는 지정 후에만 가능합니다.`;
  }
  if (!canSubmitAssessmentRun({ userId: opts.userId, authorUserId: opts.authorUserId })) {
    const who = opts.authorName?.trim() || `지정된 ${ASSESSMENT_LEGAL_AUTHOR_LABEL}`;
    return `상신은 작성 주체(${who})만 할 수 있습니다.`;
  }
  return null;
}

export function formatAssessmentAuthorLabel(candidate?: AssessmentAuthorCandidate | null): string {
  if (!candidate) return '';
  const title = candidate.role ? (ROLE_TITLE[candidate.role] || '') : '';
  const company = candidate.company_name?.trim();
  return [candidate.display_name, title, company].filter(Boolean).join(' · ');
}

export function pickAuthorCandidate(
  candidates: AssessmentAuthorCandidate[],
  authorUserId?: string | null,
): AssessmentAuthorCandidate | null {
  if (!authorUserId) return null;
  return candidates.find((c) => c.user_id === authorUserId) || null;
}
