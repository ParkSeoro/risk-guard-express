/** Normalize company display names for orphan matching (㈜/(주)/spaces → same). */
export function normalizeCompanyLabel(name: string | null | undefined): string {
  return String(name || "")
    .trim()
    .toLowerCase()
    // Strip corp suffixes before removing punctuation so "(주)" ≠ leftover "주"
    .replace(
      /㈜|㈔|㈐|\(\s*주\s*\)|\(\s*유\s*\)|\(\s*합\s*\)|주식회사|유한회사|합자회사|㈜/g,
      "",
    )
    .replace(/[^0-9a-z가-힣]+/g, "");
}

/** Orphan (company_id null) belongs to scoped company by empty or matching label. */
export function isClaimableOrphanWorker(
  worker: { company_id?: string | null; company_name?: string | null },
  ownCompanyId: string | null | undefined,
  ownCompanyName: string | null | undefined,
): boolean {
  if (worker.company_id != null) {
    return !!ownCompanyId && worker.company_id === ownCompanyId;
  }
  const own = normalizeCompanyLabel(ownCompanyName);
  const theirs = normalizeCompanyLabel(worker.company_name);
  if (!theirs) return true; // unlabeled orphan — visible to company-scoped managers
  if (!own) return false;
  return theirs === own;
}
