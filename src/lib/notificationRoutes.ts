// SSOT — 알림/푸시 클릭 시 라우팅 해석기
// 웹/모바일 어디서든 동일한 규칙으로 딥링크를 만든다.
// Canonical shells: /app/admin/* (manager), /app/worker/* (worker mobile)

export interface NotificationLike {
  link?: string | null;
  url?: string | null;
  type?: string | null;
  related_type?: string | null;
  related_id?: string | null;
  project_id?: string | null;
}

const ADMIN = "/app/admin";
const WORKER = "/app/worker";

const withProject = (base: string, projectId?: string | null) =>
  projectId ? `${base}${base.includes("?") ? "&" : "?"}project=${projectId}` : base;

const ENTITY_ROUTES: Record<string, (id?: string | null, projectId?: string | null) => string> = {
  work_plan: (id) => (id ? `${ADMIN}/work-plan/${id}` : `${ADMIN}/work-plans`),
  work_permit: (id) => (id ? `${ADMIN}/work-permits/${id}` : `${ADMIN}/work-permits`),
  assessment_run: (id) => (id ? `${ADMIN}/assessment-run/${id}` : `${ADMIN}/risk-assessment`),
  approval: () => `${ADMIN}/approvals`,
  safety_cost: () => `${ADMIN}/safety-cost`,
  safety_inspection: () => `${ADMIN}/safety-inspections`,
  incident: () => `${ADMIN}/incidents`,
  incident_report: () => `${ADMIN}/incidents`,
  emergency_drill: () => `${ADMIN}/emergency-drills`,
  tbm: () => `${ADMIN}/tbm-logs`,
  todo: () => `${ADMIN}/todo`,
  work_stop: () => `${ADMIN}/work-stop`,
  safety_cost_report: () => `${ADMIN}/safety-cost`,
  education: () => `${ADMIN}/worker-education`,
  worker: () => `${ADMIN}/workers`,
  chemical: () => `${ADMIN}/health/chemicals`,
  zone_event: (_, pid) => withProject(`${ADMIN}/zone-events`, pid),
};

const TYPE_ROUTES: Record<string, (n: NotificationLike) => string> = {
  danger_zone_entry: (n) => withProject(`${ADMIN}/zone-events`, n.project_id),
  approval_request: () => `${WORKER}/approvals`,
  approval_result: () => `${ADMIN}/approvals`,
  return_request: () => `${ADMIN}/approvals`,
  incident: () => `${ADMIN}/incidents`,
  safety_inspection: () => `${ADMIN}/safety-inspections`,
  work_permit: (n) =>
    n.related_id ? `${ADMIN}/work-permits/${n.related_id}` : `${ADMIN}/work-permits`,
  tbm: () => `${ADMIN}/tbm-logs`,
  todo_due: () => `${ADMIN}/todo`,
  health_warning: () => `${ADMIN}/health`,
  health_checkup_due: () => `${ADMIN}/health/checkups`,
};

/** Normalize legacy /m and bare admin paths into canonical shells. */
export function canonicalizeAppPath(path: string): string {
  if (!path) return path;
  if (path.startsWith("/app/")) return path;
  if (path === "/m" || path.startsWith("/m/")) {
    return path === "/m" ? WORKER : `${WORKER}${path.slice(2)}`;
  }
  if (path.startsWith("/")) return `${ADMIN}${path}`;
  return path;
}

export function resolveNotificationRoute(n: NotificationLike | null | undefined): string | null {
  if (!n) return null;
  const explicit = (n.link || n.url || "").trim();
  if (explicit) return canonicalizeAppPath(explicit);

  if (n.related_type && ENTITY_ROUTES[n.related_type]) {
    return ENTITY_ROUTES[n.related_type](n.related_id, n.project_id);
  }

  if (n.type && TYPE_ROUTES[n.type]) {
    return TYPE_ROUTES[n.type](n);
  }
  return `${WORKER}/alerts`;
}
