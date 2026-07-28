/**
 * Company type SSOT — use everywhere (Settings, Project, lists, filters).
 *
 * Hierarchy: 발주처(client) → 시공사(gc) → 협력사(contractor) → 공급사(vendor)
 */
export type CompanyTypeCode = 'client' | 'gc' | 'contractor' | 'vendor';

export const COMPANY_TYPE_LABELS: Record<CompanyTypeCode, string> = {
  client: '발주처',
  gc: '시공사',
  contractor: '협력사',
  vendor: '공급사',
};

export const COMPANY_TYPE_OPTIONS: { v: CompanyTypeCode; label: string }[] = [
  { v: 'client', label: COMPANY_TYPE_LABELS.client },
  { v: 'gc', label: COMPANY_TYPE_LABELS.gc },
  { v: 'contractor', label: COMPANY_TYPE_LABELS.contractor },
  { v: 'vendor', label: COMPANY_TYPE_LABELS.vendor },
];

/** Legacy Korean / alias → canonical code */
const ALIAS_TO_CODE: Record<string, CompanyTypeCode> = {
  client: 'client',
  발주처: 'client',
  owner: 'client',
  gc: 'gc',
  시공사: 'gc',
  원도급: 'gc',
  원청: 'gc',
  general_contractor: 'gc',
  contractor: 'contractor',
  협력사: 'contractor',
  하청: 'contractor',
  subcontractor: 'contractor',
  vendor: 'vendor',
  공급사: 'vendor',
  납품사: 'vendor',
};

export function normalizeCompanyType(raw?: string | null): CompanyTypeCode | null {
  if (!raw) return null;
  const key = String(raw).trim();
  if (!key) return null;
  return ALIAS_TO_CODE[key] || ALIAS_TO_CODE[key.toLowerCase()] || null;
}

export function companyTypeLabel(raw?: string | null): string {
  const code = normalizeCompanyType(raw);
  if (code) return COMPANY_TYPE_LABELS[code];
  return raw || '-';
}

/** Prefer project role, fall back to master type */
export function resolveProjectCompanyType(
  roleInProject?: string | null,
  masterType?: string | null,
): CompanyTypeCode | string {
  return normalizeCompanyType(roleInProject) || normalizeCompanyType(masterType) || roleInProject || masterType || 'contractor';
}

export function isGcType(raw?: string | null) {
  return normalizeCompanyType(raw) === 'gc';
}
export function isContractorType(raw?: string | null) {
  const t = normalizeCompanyType(raw);
  return t === 'contractor' || t === 'vendor';
}
export function isClientType(raw?: string | null) {
  return normalizeCompanyType(raw) === 'client';
}
