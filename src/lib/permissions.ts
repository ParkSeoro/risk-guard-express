/**
 * App-wide role union used by AuthContext / AuthGuard.
 * Global: user_roles.role (currently only `master`).
 * Project: project_members.role_new (SSOT for partner/company admins).
 */
export type GlobalRole = "master";

export type ProjectRole =
  | "project_admin"
  | "safety_manager"
  | "site_manager"
  | "supervisor"
  | "site_supervisor"
  | "worker"
  | "viewer";

/** Combined role string carried in AuthContext.roles */
export type AppRole = GlobalRole | ProjectRole | (string & {});

export const ADMIN_PROJECT_ROLES: ProjectRole[] = [
  "project_admin",
  "safety_manager",
  "site_manager",
  "supervisor",
  "site_supervisor",
];

export const WORKER_PROJECT_ROLES: ProjectRole[] = ["worker", "viewer"];
