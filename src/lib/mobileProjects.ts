/**
 * Mobile project picker helpers — membership rows can fan out under RLS.
 */

export type MobileProjectOption = { id: string; name: string };

/** Keep first occurrence per project id (stable order). */
export function dedupeProjectsById(list: MobileProjectOption[]): MobileProjectOption[] {
  const byId = new Map<string, MobileProjectOption>();
  for (const p of list) {
    if (!p?.id || byId.has(p.id)) continue;
    byId.set(p.id, { id: p.id, name: p.name || p.id });
  }
  return [...byId.values()];
}

/** Map project_members(+projects) rows → unique project options. */
export function projectsFromMembershipRows(
  rows: Array<{ project_id?: string | null; projects?: { id?: string; name?: string | null } | null }> | null | undefined,
): MobileProjectOption[] {
  const list: MobileProjectOption[] = [];
  for (const r of rows || []) {
    const p = r.projects;
    if (p?.id) list.push({ id: p.id, name: p.name || p.id });
    else if (r.project_id) list.push({ id: r.project_id, name: r.project_id });
  }
  return dedupeProjectsById(list);
}
