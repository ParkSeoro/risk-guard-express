/** Client (발주처) OWNER_SM may approve manager signup for their project. */

export type OwnerSmMembershipLike = {
  project_id?: string | null;
  position_new?: string | null;
  position?: string | null;
  company_type?: string | null;
  companies?: { type?: string | null } | null;
};

export function normalizeCompanyType(raw: string | null | undefined): string {
  return String(raw || "")
    .trim()
    .toLowerCase();
}

export function isClientOwnerSmMembership(m: OwnerSmMembershipLike | null | undefined): boolean {
  if (!m) return false;
  const companyType = normalizeCompanyType(m.company_type ?? m.companies?.type);
  if (companyType !== "client") return false;
  const pos = String(m.position_new || m.position || "")
    .trim()
    .toUpperCase();
  return pos === "OWNER_SM" || pos === "OWNER_HSE";
}

/** Master always; otherwise caller must be 발주처 SM on a project the pending user joined. */
export function canApprovePendingSignup(opts: {
  isMaster?: boolean;
  approverMemberships?: OwnerSmMembershipLike[] | null;
  targetProjectIds?: Array<string | null | undefined> | null;
}): boolean {
  if (opts.isMaster) return true;
  const targets = new Set(
    (opts.targetProjectIds || []).map((id) => String(id || "").trim()).filter(Boolean),
  );
  if (targets.size === 0) return false;
  return (opts.approverMemberships || []).some(
    (m) => m?.project_id && targets.has(String(m.project_id)) && isClientOwnerSmMembership(m),
  );
}

export function isClientOwnerSmAnywhere(
  memberships?: OwnerSmMembershipLike[] | null,
): boolean {
  return (memberships || []).some((m) => isClientOwnerSmMembership(m));
}
