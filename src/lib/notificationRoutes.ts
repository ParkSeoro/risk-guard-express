/**
 * 알림 → 앱 내 라우트 해석 (인앱 벨 / 웹 SW / Capacitor 푸시 클릭 공용)
 */
export type NotificationRouteInput = {
  type?: string | null;
  related_type?: string | null;
  related_id?: string | null;
  link?: string | null;
  project_id?: string | null;
  url?: string | null;
};

const RELATED_ROUTE_MAP: Record<string, (id?: string, projectId?: string) => string> = {
  zone_event: (_id, projectId) =>
    projectId ? `/zone-events?project=${projectId}` : "/zone-events",
  assessment_run: (id) => (id ? `/assessment-run/${id}` : "/risk-assessment"),
  approval: () => "/m/approvals",
  work_permit: (id) => (id ? `/work-permits/${id}` : "/work-permits"),
  work_plan: (id) => (id ? `/work-plan/${id}` : "/work-plans"),
  safety_inspection: () => "/safety-inspections",
  incident_report: () => "/incidents",
  incident: () => "/incidents",
  emergency_drill: () => "/emergency-drills",
  todo: () => "/todo",
  work_stop: () => "/work-stop",
  safety_cost_report: () => "/safety-cost",
  safety_cost: () => "/safety-cost",
  education: () => "/worker-education",
  worker: () => "/workers",
  chemical: () => "/health/chemicals",
  tbm: () => "/tbm-logs",
};

export function resolveNotificationRoute(n: NotificationRouteInput): string {
  const explicit = n.link || n.url;
  if (explicit && explicit.startsWith("/")) return explicit;

  const related = n.related_type || "";
  const fn = RELATED_ROUTE_MAP[related];
  if (fn) return fn(n.related_id || undefined, n.project_id || undefined);

  const type = n.type || "";
  if (type === "danger_zone_entry" || type === "critical_alert") {
    return n.project_id ? `/zone-events?project=${n.project_id}` : "/zone-events";
  }
  if (type.startsWith("approval")) return "/m/approvals";
  if (type === "incident") return "/incidents";

  return "/m/alerts";
}
