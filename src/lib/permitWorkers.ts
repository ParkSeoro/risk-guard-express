/**
 * Work permit crew helpers — keep personnel_count in sync with work_permit_workers.
 */

export type PermitWorkerRow = {
  id: string;
  name: string;
  phone?: string | null;
  company_name?: string | null;
};

/** Merge assigned crew size into form_data + column payload. */
export function buildPersonnelCountPatch(
  formData: Record<string, unknown> | null | undefined,
  assignedCount: number,
): { personnel_count: number; form_data: Record<string, unknown> } {
  const base =
    formData && typeof formData === "object" && !Array.isArray(formData)
      ? { ...formData }
      : {};
  return {
    personnel_count: assignedCount,
    form_data: { ...base, personnel_count: assignedCount },
  };
}

export function formatWorkerPhone(phone?: string | null): string {
  if (!phone) return "-";
  const d = phone.replace(/\D/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return phone;
}
