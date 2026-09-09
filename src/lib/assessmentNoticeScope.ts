/**
 * 위험성평가 공지 목록 스코프.
 * 발주처(전체) / 시공사(자사+하위 협력사) / 협력사(자사).
 */
export function noticeCompanyIdsForRun(
  run: {
    target_company_ids?: string[] | null;
    author_user_id?: string | null;
    created_by?: string | null;
    company_ids?: string[] | null;
  },
  authorCompanyIdByUser?: Record<string, string | null | undefined>,
): string[] {
  const stored = (run.company_ids || []).map(String).filter(Boolean);
  if (stored.length) return stored;
  const targets = (run.target_company_ids || []).map(String).filter(Boolean);
  if (targets.length) return targets;
  const uid = run.author_user_id || run.created_by;
  const authorCo = uid ? String(authorCompanyIdByUser?.[uid] || "").trim() : "";
  return authorCo ? [authorCo] : [];
}

export function filterAssessmentNoticesByCompanyScope<T extends {
  run_id?: string | null;
  company_ids?: string[] | null;
}>(
  notices: T[],
  opts: {
    accessibleCompanyIds: string[] | null;
    companyIdsByRunId: Record<string, string[]>;
  },
): T[] {
  if (opts.accessibleCompanyIds === null) return notices;
  const allow = new Set(opts.accessibleCompanyIds.map(String));
  return notices.filter((n) => {
    if (!n.run_id) return true;
    const fromNotice = (n.company_ids || []).map(String).filter(Boolean);
    const ids = fromNotice.length ? fromNotice : opts.companyIdsByRunId[n.run_id] || [];
    if (ids.length === 0) return true;
    return ids.some((id) => allow.has(id));
  });
}
