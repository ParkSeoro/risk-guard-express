/**
 * Work-stop (작업중지권) SSOT — identity, insert payload, notify copy, home layout.
 * Legal basis: 산업안전보건법 제52조 (근로자의 작업중지 · 불리한 처우 금지).
 */

export const ANONYMOUS_REPORTER_LABEL = "익명 근로자";
export const WORK_STOP_LEGAL_CITE = "산업안전보건법 제52조";
export const WORK_STOP_OPEN_STATUSES = ["접수", "확인중"] as const;
/** Workers attach scene photos so managers can see the hazard immediately. */
export const WORK_STOP_MAX_PHOTOS = 3;

/** One URL, or a JSON array of URLs, stored in work_stop_requests.photo_url. */
export function parseWorkStopPhotoUrls(raw: string | null | undefined): string[] {
  const s = String(raw || "").trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const arr = JSON.parse(s);
      return Array.isArray(arr)
        ? arr.map((u) => String(u || "").trim()).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  }
  return [s];
}

export function serializeWorkStopPhotos(urls: string[]): string | null {
  const clean = urls.map((u) => String(u || "").trim()).filter(Boolean);
  if (clean.length === 0) return null;
  if (clean.length === 1) return clean[0];
  return JSON.stringify(clean);
}

export type WorkStopIdentityMode = "anonymous" | "named";

export type WorkStopIdentityRow = {
  is_anonymous?: boolean | null;
  reporter_name?: string | null;
};

/** Admin / list / push display name. Never returns a stored legal name when anonymous. */
export function workStopDisplayName(row: WorkStopIdentityRow): string {
  if (row.is_anonymous) return ANONYMOUS_REPORTER_LABEL;
  const name = (row.reporter_name || "").trim();
  return name || "근로자";
}

export function workStopNotifyMessage(row: WorkStopIdentityRow & {
  location?: string | null;
  hazard_description?: string | null;
}): string {
  const who = workStopDisplayName(row);
  const loc = (row.location || "").trim();
  const hazard = (row.hazard_description || "").trim() || "위험상황";
  return loc ? `${who} · ${loc} — ${hazard}` : `${who} — ${hazard}`;
}

export function validateWorkStopForm(opts: {
  projectId?: string | null;
  isAnonymous: boolean;
  reporterName: string;
  hazardDescription: string;
  photoCount?: number;
}): string | null {
  if (!opts.projectId) return "프로젝트 선택이 필요합니다";
  if (!opts.hazardDescription.trim()) return "위험상황은 필수입니다";
  if (!opts.isAnonymous && !opts.reporterName.trim()) {
    return "실명 신고 시 보고자명이 필요합니다";
  }
  if ((opts.photoCount ?? 0) < 1) return "현장 사진을 첨부하세요";
  if ((opts.photoCount ?? 0) > WORK_STOP_MAX_PHOTOS) {
    return `현장 사진은 최대 ${WORK_STOP_MAX_PHOTOS}장입니다`;
  }
  return null;
}

/** Persist placeholder name when anonymous so select(*) UIs cannot leak identity. */
export function buildWorkStopInsert(opts: {
  projectId: string;
  workerId?: string | null;
  reporterUserId?: string | null;
  reporterName: string;
  location?: string | null;
  hazardDescription: string;
  isAnonymous: boolean;
  photoUrl?: string | null;
}): {
  project_id: string;
  worker_id: string | null;
  reporter_user_id: string | null;
  is_anonymous: boolean;
  reporter_name: string;
  location: string | null;
  hazard_description: string;
  photo_url: string | null;
  status: "접수";
} {
  return {
    project_id: opts.projectId,
    worker_id: opts.workerId || null,
    reporter_user_id: opts.reporterUserId || null,
    is_anonymous: opts.isAnonymous,
    reporter_name: opts.isAnonymous
      ? ANONYMOUS_REPORTER_LABEL
      : opts.reporterName.trim(),
    location: (opts.location || "").trim() || null,
    hazard_description: opts.hazardDescription.trim(),
    photo_url: opts.photoUrl?.trim() || null,
    status: "접수",
  };
}

/** GPS diagnostics stay off the worker home after clock-in (tracking continues in background). */
export function shouldShowHomeGpsCard(isCheckedIn: boolean): boolean {
  return !isCheckedIn;
}

/** Work-stop CTA is a legal emergency control — only after the worker is on site. */
export function shouldShowHomeWorkStopCard(isCheckedIn: boolean): boolean {
  return isCheckedIn;
}

export function isWorkStopOpenStatus(status: string | null | undefined): boolean {
  return WORK_STOP_OPEN_STATUSES.includes((status || "") as (typeof WORK_STOP_OPEN_STATUSES)[number]);
}

/** Recipients: same-company managers + project safety + 발주처 OWNER_* (no workers/viewers). */
export function isWorkStopNotifyRecipient(member: {
  role_new?: string | null;
  position_new?: string | null;
  company_id?: string | null;
  user_id?: string | null;
}, reporterCompanyId: string | null): boolean {
  if (!member.user_id) return false;
  const role = member.role_new || "";
  if (role === "worker" || role === "viewer") return false;
  const pos = member.position_new || "";
  if (reporterCompanyId && member.company_id === reporterCompanyId) return true;
  if (role === "project_admin" || role === "safety_manager" || role === "site_manager") return true;
  return (
    pos === "OWNER_HSE" ||
    pos === "OWNER_SM" ||
    pos === "OWNER_PM" ||
    pos === "OWNER_CM" ||
    pos === "SITE_MANAGER" ||
    pos === "HSE_MANAGER"
  );
}
