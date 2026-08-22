// SSOT — 알림/푸시 클릭 시 라우팅 해석기
// 웹/모바일 어디서든 동일한 규칙으로 딥링크를 만든다.
// Canonical shells: /app/admin/* (manager), /app/worker/* (worker mobile)

import { prefersMobileAppShell } from "@/hooks/use-mobile";

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

type RouteFn = (id?: string | null, projectId?: string | null) => string;

const ADMIN_ENTITY_ROUTES: Record<string, RouteFn> = {
  work_plan: (id) => (id ? `${ADMIN}/work-plan/${id}` : `${ADMIN}/work-plans`),
  announcement: (id) => (id ? `${ADMIN}/announcements?id=${id}` : `${ADMIN}/announcements`),
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
  vision_safety_event: (id) =>
    id ? `${ADMIN}/vision-fleet?event=${id}` : `${ADMIN}/vision-fleet`,
};

/** Mobile shell equivalents — prefer list/viewer pages that exist under /app/worker. */
const MOBILE_ENTITY_ROUTES: Record<string, RouteFn> = {
  work_plan: (id) => (id ? `${WORKER}/work-plans/${id}` : `${WORKER}/work-plans`),
  announcement: (id) => (id ? `${WORKER}/announcements?id=${id}` : `${WORKER}/announcements`),
  work_permit: (id) =>
    id ? `${WORKER}/approvals` : `${WORKER}/permits`,
  assessment_run: (id) => (id ? `${WORKER}/risk-assessment/${id}` : `${WORKER}/risk-assessment`),
  approval: (id) => (id ? `${WORKER}/approvals/${id}` : `${WORKER}/approvals`),
  safety_inspection: () => `${WORKER}/inspect`,
  incident: () => `${WORKER}/incident`,
  incident_report: () => `${WORKER}/incident`,
  tbm: () => `${WORKER}/tbm`,
  work_stop: () => `${WORKER}/work-stop`,
  // No dedicated mobile page yet → Today (avoid silent desktop jump)
  safety_cost: () => `${WORKER}/today`,
  safety_cost_report: () => `${WORKER}/today`,
  emergency_drill: () => `${WORKER}/today`,
  todo: () => `${WORKER}/tasks`,
  education: () => `${WORKER}/docs`,
  worker: () => `${WORKER}/workers`,
  chemical: () => `${WORKER}/today`,
  zone_event: () => `${WORKER}/alerts`,
  vision_safety_event: (id) =>
    id ? `${WORKER}/vision-events?event=${id}` : `${WORKER}/vision-events`,
};

const ADMIN_TYPE_ROUTES: Record<string, (n: NotificationLike) => string> = {
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
  announcement: (n) =>
    n.related_id ? `${ADMIN}/announcements?id=${n.related_id}` : `${ADMIN}/announcements`,
  vision_safety_event: (n) =>
    n.related_id ? `${ADMIN}/vision-fleet?event=${n.related_id}` : `${ADMIN}/vision-fleet`,
};

const MOBILE_TYPE_ROUTES: Record<string, (n: NotificationLike) => string> = {
  danger_zone_entry: () => `${WORKER}/alerts`,
  approval_request: () => `${WORKER}/approvals`,
  approval_result: () => `${WORKER}/approvals`,
  return_request: () => `${WORKER}/approvals`,
  incident: () => `${WORKER}/incident`,
  safety_inspection: () => `${WORKER}/inspect`,
  work_permit: () => `${WORKER}/approvals`,
  tbm: () => `${WORKER}/tbm`,
  todo_due: () => `${WORKER}/tasks`,
  health_warning: () => `${WORKER}/daily-health-log`,
  health_checkup_due: () => `${WORKER}/daily-health-log`,
  announcement: (n) =>
    n.related_id ? `${WORKER}/announcements?id=${n.related_id}` : `${WORKER}/announcements`,
  vision_safety_event: (n) =>
    n.related_id ? `${WORKER}/vision-events?event=${n.related_id}` : `${WORKER}/vision-events`,
};

/** Map known admin paths into mobile equivalents when on phone shell. */
export function toMobileShellPath(path: string): string {
  if (!path) return path;
  let p = path;
  if (p.startsWith(ADMIN)) p = p.slice(ADMIN.length) || "/";
  // Already worker
  if (path.startsWith(WORKER) || path.startsWith("/m")) {
    return canonicalizeAppPath(path);
  }

  const ar = p.match(/^\/assessment-run\/([^/?#]+)/);
  if (ar) return `${WORKER}/risk-assessment/${ar[1]}`;
  const wp = p.match(/^\/work-plan\/([^/?#]+)/);
  if (wp) return `${WORKER}/work-plans/${wp[1]}`;

  if (p.startsWith("/approvals")) return `${WORKER}/approvals`;
  const permit = p.match(/^\/work-permits\/([^/?#]+)/);
  if (permit) return `${WORKER}/permits?id=${permit[1]}`;
  if (p.startsWith("/work-permits")) return `${WORKER}/permits`;
  if (p.startsWith("/work-plans")) return `${WORKER}/work-plans`;
  if (p.startsWith("/risk-assessment")) return `${WORKER}/risk-assessment`;
  if (p.startsWith("/safety-inspections")) return `${WORKER}/inspect`;
  if (p.startsWith("/incidents")) return `${WORKER}/incident`;
  if (p.startsWith("/tbm")) return `${WORKER}/tbm`;
  if (p.startsWith("/work-stop")) return `${WORKER}/work-stop`;
  if (p.startsWith("/workers")) return `${WORKER}/workers`;
  if (p.startsWith("/announcements")) return `${WORKER}/announcements`;
  if (p.startsWith("/vision-fleet") || p.startsWith("/vision-events")) {
    const q = p.includes("?") ? p.slice(p.indexOf("?")) : "";
    return `${WORKER}/vision-events${q}`;
  }
  if (p.startsWith("/vision-pair")) return `${WORKER}${p}`;
  if (p.startsWith("/zone-events")) return `${WORKER}/alerts`;
  if (p.startsWith("/settings")) return `${WORKER}/account`;
  if (p === "/" || p === "") return `${WORKER}/menu`;

  // Unknown admin feature — stay in mobile shell rather than flipping to desktop
  return `${WORKER}/today`;
}

/** Normalize legacy /m and bare admin paths into canonical shells. */
export function canonicalizeAppPath(path: string, opts?: { mobileShell?: boolean }): string {
  if (!path) return path;
  const mobile = opts?.mobileShell ?? (typeof window !== "undefined" && prefersMobileAppShell());

  if (path.startsWith("/app/worker")) {
    if (path === `${WORKER}/menu` || path === `${WORKER}/home`) return `${WORKER}/today`;
    return path;
  }
  if (path === "/m" || path.startsWith("/m/")) {
    const rest = path === "/m" ? "/today" : path.slice(2);
    const mapped = rest === "/menu" || rest === "/home" ? "/today" : rest;
    return `${WORKER}${mapped}`;
  }
  if (path.startsWith("/app/admin")) {
    return mobile ? toMobileShellPath(path) : path;
  }
  if (path.startsWith("/")) {
    const adminPath = `${ADMIN}${path}`;
    return mobile ? toMobileShellPath(adminPath) : adminPath;
  }
  return path;
}

export function resolveNotificationRoute(
  n: NotificationLike | null | undefined,
  opts?: { mobileShell?: boolean },
): string | null {
  if (!n) return null;
  const mobile = opts?.mobileShell ?? (typeof window !== "undefined" && prefersMobileAppShell());

  const explicit = (n.link || n.url || "").trim();
  if (explicit) return canonicalizeAppPath(explicit, { mobileShell: mobile });

  const entityMap = mobile ? MOBILE_ENTITY_ROUTES : ADMIN_ENTITY_ROUTES;
  if (n.related_type && entityMap[n.related_type]) {
    return entityMap[n.related_type](n.related_id, n.project_id);
  }

  const typeMap = mobile ? MOBILE_TYPE_ROUTES : ADMIN_TYPE_ROUTES;
  if (n.type && typeMap[n.type]) {
    return typeMap[n.type](n);
  }
  return `${WORKER}/alerts`;
}
