/**
 * SSOT: who may INSERT/UPDATE public.risk_items.
 * Must match RLS policies in
 * supabase/migrations/20260811073000_risk_items_site_supervisor_write.sql
 *
 * 고시 §7 작성 주체 = site_supervisor(관리감독자).
 * supervisor(감리)는 RO — 여기에 넣지 말 것.
 */
export const RISK_ITEM_WRITE_ROLES = [
  'project_admin',
  'safety_manager',
  'site_manager',
  'site_supervisor',
] as const;

export type RiskItemWriteRole = (typeof RISK_ITEM_WRITE_ROLES)[number];

export const RISK_ITEM_WRITE_ROLES_LABEL =
  'project_admin / safety_manager / site_manager / site_supervisor(관리감독자)';

export function canWriteRiskItems(role: string | null | undefined): boolean {
  if (!role) return false;
  return (RISK_ITEM_WRITE_ROLES as readonly string[]).includes(role);
}

export function riskItemsWriteDeniedMessage(currentRole?: string | null): string {
  const cur = currentRole ? ` 현재 역할: ${currentRole}.` : '';
  return `위험성평가 항목을 저장할 권한이 없습니다.${cur} ${RISK_ITEM_WRITE_ROLES_LABEL} 계정이 필요합니다.`;
}

/** Postgres project_role[] literal for migrations / docs (keep in sync). */
export const RISK_ITEM_WRITE_ROLES_SQL =
  "ARRAY['project_admin','safety_manager','site_manager','site_supervisor']::public.project_role[]";
