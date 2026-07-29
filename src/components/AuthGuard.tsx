/**
 * Role-based auth + traffic routing.
 * - Unauthenticated → /login
 * - Worker-only roles → /app/worker
 * - Admin/supervisor roles → /app/admin
 */
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { ReactNode } from "react";

export const ADMIN_SHELL_ROLES = [
  "master",
  "project_admin",
  "safety_manager",
  "site_manager",
  "supervisor",
  "site_supervisor",
] as const;

export const WORKER_SHELL_ROLES = ["worker", "viewer"] as const;

export type ShellKind = "admin" | "worker";

export function resolvePostLoginShell(roles: string[]): ShellKind {
  const set = new Set(roles.map((r) => r.toLowerCase()));
  if (ADMIN_SHELL_ROLES.some((r) => set.has(r))) return "admin";
  if (WORKER_SHELL_ROLES.some((r) => set.has(r))) return "worker";
  // No role yet / unknown → worker shell (safer for field devices)
  return "worker";
}

export function postLoginPath(roles: string[]): string {
  return resolvePostLoginShell(roles) === "admin" ? "/app/admin" : "/app/worker";
}

type AuthGuardProps = {
  children: ReactNode;
  /** Which shell this guard protects */
  shell: ShellKind;
  /** Allow unauthenticated render (legacy; prefer false) */
  allowAnonymous?: boolean;
};

function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
      세션 확인 중…
    </div>
  );
}

export default function AuthGuard({ children, shell, allowAnonymous = false }: AuthGuardProps) {
  const { user, loading, roles } = useAuth();
  const location = useLocation();

  if (loading) return <Loading />;

  if (!user) {
    if (allowAnonymous) return <>{children}</>;
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  const preferred = resolvePostLoginShell(roles);

  // Worker shell: block admin-only users from living in worker UI accidentally? Allow both.
  // Admin shell: workers without admin roles are redirected to worker home.
  if (shell === "admin" && preferred === "worker") {
    return <Navigate to="/app/worker/home" replace />;
  }

  return <>{children}</>;
}

/** Login success redirect by role (use inside AuthRoute). */
export function RoleHomeRedirect() {
  const { user, loading, roles } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={postLoginPath(roles)} replace />;
}
