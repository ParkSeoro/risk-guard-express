// SSOT — 알림/푸시 클릭 시 라우팅 해석기
// 웹/모바일 어디서든 동일한 규칙으로 딥링크를 만든다.

export interface NotificationLike {
  link?: string | null;
  url?: string | null;
  type?: string | null;
  related_type?: string | null;
  related_id?: string | null;
  project_id?: string | null;
}

const withProject = (base: string, projectId?: string | null) =>
  projectId ? `${base}${base.includes('?') ? '&' : '?'}project=${projectId}` : base;

const ENTITY_ROUTES: Record<string, (id?: string | null, projectId?: string | null) => string> = {
  work_plan: (id) => (id ? `/work-plan/${id}` : '/work-plans'),
  work_permit: (id) => (id ? `/work-permits/${id}` : '/work-permits'),
  assessment_run: (id) => (id ? `/assessment-run/${id}` : '/risk-assessment'),
  approval: () => '/approvals',
  safety_cost: () => '/safety-cost',
  safety_inspection: () => '/safety-inspections',
  incident: () => '/incidents',
  incident_report: () => '/incidents',
  emergency_drill: () => '/emergency-drills',
  tbm: () => '/tbm-logs',
  todo: () => '/todo',
  work_stop: () => '/work-stop',
  safety_cost_report: () => '/safety-cost',
  education: () => '/worker-education',
  worker: () => '/workers',
  chemical: () => '/health/chemicals',
  zone_event: (_, pid) => withProject('/zone-events', pid),
};

const TYPE_ROUTES: Record<string, (n: NotificationLike) => string> = {
  danger_zone_entry: (n) => withProject('/zone-events', n.project_id),
  approval_request: () => '/m/approvals',
  approval_result: () => '/approvals',
  return_request: () => '/approvals',
  incident: () => '/incidents',
  safety_inspection: () => '/safety-inspections',
  work_permit: (n) => (n.related_id ? `/work-permits/${n.related_id}` : '/work-permits'),
  tbm: () => '/tbm-logs',
  todo_due: () => '/todo',
  health_warning: () => '/health',
  health_checkup_due: () => '/health/checkups',
};

export function resolveNotificationRoute(n: NotificationLike | null | undefined): string | null {
  if (!n) return null;
  // 1) explicit link/url wins
  const explicit = (n.link || n.url || '').trim();
  if (explicit) return explicit;

  // 2) related_type mapping
  if (n.related_type && ENTITY_ROUTES[n.related_type]) {
    return ENTITY_ROUTES[n.related_type](n.related_id, n.project_id);
  }

  // 3) type mapping
  if (n.type && TYPE_ROUTES[n.type]) {
    return TYPE_ROUTES[n.type](n);
  }
  return '/m/alerts';
}
