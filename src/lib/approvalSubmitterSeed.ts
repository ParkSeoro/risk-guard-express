export type SeedableStep = {
  position?: string;
  user_id?: string;
  user_name?: string;
  company_id?: string | null;
  company_name?: string;
};

export type SeedableApprover = {
  out_user_id: string;
  out_display_name: string;
  out_company_id: string | null;
  out_company_name: string;
};

/** Prefer the legal author, then the logged-in user, for the empty 상신 step. */
export function preferredSubmitterUserId(opts: {
  authorUserId?: string | null;
  loggedInUserId?: string | null;
}): string | null {
  return opts.authorUserId || opts.loggedInUserId || null;
}

function isSubmitterPosition(position?: string): boolean {
  const p = (position || '').toLowerCase();
  return p === 'contractor_supervisor' || p === 'contractor_pic';
}

/** Fill contractor_supervisor with the preferred user when they are eligible.
 *  `overwrite` replaces a template assignee — 상신칸은 상신자 본인만. */
export function seedSubmitterStep<T extends SeedableStep>(
  rawSteps: T[],
  approverList: SeedableApprover[],
  preferredUserId: string | null,
  opts?: { overwrite?: boolean },
): T[] {
  if (!preferredUserId) return rawSteps;
  const idx = rawSteps.findIndex((s) => isSubmitterPosition(s.position));
  if (idx < 0) return rawSteps;
  if (rawSteps[idx].user_id && !opts?.overwrite) return rawSteps;
  const me = approverList.find((a) => a.out_user_id === preferredUserId);
  if (!me) return rawSteps;
  const next = [...rawSteps];
  next[idx] = {
    ...next[idx],
    user_id: me.out_user_id,
    user_name: me.out_display_name,
    company_id: me.out_company_id,
    company_name: me.out_company_name,
  };
  return next;
}
