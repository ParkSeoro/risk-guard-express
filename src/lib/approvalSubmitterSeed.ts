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

/** Fill empty contractor_supervisor step with the preferred user when they are eligible. */
export function seedSubmitterStep<T extends SeedableStep>(
  rawSteps: T[],
  approverList: SeedableApprover[],
  preferredUserId: string | null,
): T[] {
  if (!preferredUserId) return rawSteps;
  const idx = rawSteps.findIndex(
    (s) => (s.position || '').toLowerCase() === 'contractor_supervisor',
  );
  if (idx < 0 || rawSteps[idx].user_id) return rawSteps;
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
