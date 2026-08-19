import { POSITION_LABELS as PROJECT_POSITION_LABELS } from '@/lib/projectPositions';

/**
 * 서명란 「직책」열: 결재 슬롯 키·인사 직책을 사람 직함으로.
 * 「구분」열은 step 라벨(담당자(시공) 등)을 그대로 쓴다.
 */
const APPROVAL_SLOT_JOB_TITLE: Record<string, string> = {
  contractor_supervisor: '관리감독자',
  contractor_pic: '관리감독자',
  contractor_safety_manager: '안전관리자',
  safety_pic: '안전관리자',
  contractor_site_director: '현장소장',
  site_director: '현장소장',
  owner_sm: '발주처 SM',
  sm: '발주처 SM',
  owner_cm: '발주처 CM',
  cm: '발주처 CM',
  gc: '시공사',
  gc_manager: '시공사 관리자',
  gc_pm: '시공사 PM',
  cooperator: '협조부서',
  project_admin: '프로젝트 관리자',
  site_supervisor: '관리감독자',
};

export function jobTitleLabel(position?: string | null): string {
  const raw = String(position || '').trim();
  if (!raw) return '';
  if (APPROVAL_SLOT_JOB_TITLE[raw]) return APPROVAL_SLOT_JOB_TITLE[raw];
  const lower = raw.toLowerCase();
  if (APPROVAL_SLOT_JOB_TITLE[lower]) return APPROVAL_SLOT_JOB_TITLE[lower];
  if (PROJECT_POSITION_LABELS[raw]) return PROJECT_POSITION_LABELS[raw];
  const upper = raw.toUpperCase();
  if (PROJECT_POSITION_LABELS[upper]) return PROJECT_POSITION_LABELS[upper];
  return raw;
}

/** "차강찬 / SITE_SUPERVISOR" → "차강찬 / 관리감독자" */
export function localizePersonName(name?: string | null): string {
  const raw = String(name || '').trim();
  return raw.replace(/\s*\/\s*([A-Za-z0-9_]+)\s*$/, (_, code: string) => {
    const label = jobTitleLabel(code);
    return label ? ` / ${label}` : ` / ${code}`;
  });
}
