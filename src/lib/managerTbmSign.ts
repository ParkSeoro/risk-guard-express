import { isClientType } from "@/lib/companyTypes";

/** 시공사·협력사·공급사만 TBM 확인 서명. 발주처는 제외. */
export function needsManagerTbmSign(companyType?: string | null): boolean {
  if (!companyType) return true;
  return !isClientType(companyType);
}

export function managerTbmSignPath(sessionId?: string | null): string {
  return sessionId
    ? `/app/worker/tbm-sign?session=${encodeURIComponent(sessionId)}`
    : "/app/worker/tbm-sign";
}

export type PendingManagerTbmSign = {
  session_id: string;
  project_id: string;
  project_name?: string | null;
  title?: string | null;
  tbm_date?: string | null;
  location?: string | null;
  leader_name?: string | null;
  briefing_summary?: string | null;
  briefing_risks?: unknown;
  company_name?: string | null;
  qr_token?: string | null;
};

export function mapPendingManagerTbmSign(raw: any): PendingManagerTbmSign | null {
  const id = raw?.session_id || raw?.id;
  if (!id) return null;
  return {
    session_id: String(id),
    project_id: String(raw.project_id || ""),
    project_name: raw.project_name ?? null,
    title: raw.title ?? null,
    tbm_date: raw.tbm_date ?? null,
    location: raw.location ?? null,
    leader_name: raw.leader_name ?? null,
    briefing_summary: raw.briefing_summary ?? null,
    briefing_risks: raw.briefing_risks,
    company_name: raw.company_name ?? null,
    qr_token: raw.qr_token ?? null,
  };
}
