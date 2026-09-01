/**
 * Work permit crew helpers — keep personnel_count in sync with work_permit_workers.
 */
import { isClaimableOrphanWorker } from "@/lib/companyLabel";

export type PermitWorkerRow = {
  id: string;
  name: string;
  phone?: string | null;
  company_name?: string | null;
  company_id?: string | null;
  /** 을지 명단에서 관리자로 표시 */
  isManager?: boolean;
  /** 출근 전자서명. 없으면 을지 인쇄 시 빈 칸(수기). */
  signature_data?: string | null;
};

/**
 * Workers eligible to assign on a permit = same company as the permit.
 * Orphans (company_id null) only if company_name matches (normalized).
 * Never mix peer contractors into another firm's permit crew.
 */
export function filterPermitAssignableWorkers<
  T extends { company_id?: string | null; company_name?: string | null },
>(
  workers: T[],
  permitCompanyId: string | null | undefined,
  permitCompanyName: string | null | undefined,
): T[] {
  if (!permitCompanyId) return [];
  return workers.filter((w) =>
    isClaimableOrphanWorker(w, permitCompanyId, permitCompanyName),
  );
}

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

/**
 * Print-only 을지/TBM appendix: do not JS-chunk to a fixed N-per-page.
 * The browser fills A4; leftover rows continue on the next sheet.
 * `chunkForPrintPages` remains for callers that still need a fixed split.
 */
export function chunkForPrintPages<T>(rows: T[], size: number): T[][] {
  if (size <= 0) return [rows];
  if (rows.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

