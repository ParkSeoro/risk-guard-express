/**
 * Approval inbox visibility: company scope applies to which *documents* appear,
 * not which *steps* of a visible document are shown.
 * Cross-company approval chains (e.g. GC submit → owner SM reject) must keep full timeline + comments.
 */
export function approvalDocumentKey(ap: {
  entity_type?: string | null;
  entity_id?: string | null;
  run_id?: string | null;
}): string | null {
  const id = ap.entity_id || ap.run_id;
  if (!id) return null;
  const type = ap.entity_type || (ap.run_id ? "assessment_run" : null);
  if (!type) return null;
  return `${type}:${id}`;
}

export function filterApprovalsKeepingFullDocumentTimeline<
  T extends {
    entity_type?: string | null;
    entity_id?: string | null;
    run_id?: string | null;
    approver_id?: string | null;
    company_id?: string | null;
  },
>(
  rows: T[],
  opts: {
    userId?: string | null;
    accessibleCompanyIds: string[] | null; // null = master/owner sees all
  },
): T[] {
  if (opts.accessibleCompanyIds === null) return rows;
  const allow = new Set(opts.accessibleCompanyIds);
  const visibleKeys = new Set<string>();

  for (const ap of rows) {
    const key = approvalDocumentKey(ap);
    if (!key) continue;
    if (opts.userId && ap.approver_id === opts.userId) {
      visibleKeys.add(key);
      continue;
    }
    if (ap.company_id && allow.has(ap.company_id)) {
      visibleKeys.add(key);
    }
  }

  return rows.filter((ap) => {
    const key = approvalDocumentKey(ap);
    return !!key && visibleKeys.has(key);
  });
}
