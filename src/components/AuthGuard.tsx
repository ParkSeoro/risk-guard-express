/**
 * Role-based auth + traffic routing + worker legal consent intercept.
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
  return "worker";
}

/** Worker needs legal consent before any worker-shell feature. */
export function workerNeedsConsent(profile: {
  agreed_to_location?: boolean | null;
  agreed_to_terms?: boolean | null;
  agreed_to_privacy?: boolean | null;
} | null): boolean {
  if (!profile) return true;
  return !(
    profile.agreed_to_location === true &&
    profile.agreed_to_terms === true &&
    profile.agreed_to_privacy === true
  );
}

export function postLoginPath(
  roles: string[],
  profile?: {
    agreed_to_location?: boolean | null;
    agreed_to_terms?: boolean | null;
    agreed_to_privacy?: boolean | null;
  } | null,
): string {
  if (resolvePostLoginShell(roles) === "admin") return "/app/admin";
  if (workerNeedsConsent(profile ?? null)) return "/app/worker/onboarding";
  return "/app/worker/home";
}

type AuthGuardProps = {
  children: ReactNode;
  shell: ShellKind;
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
  const { user, loading, roles, profile } = useAuth();
  const location = useLocation();

  if (loading) return <Loading />;

  if (!user) {
    if (allowAnonymous) return <>{children}</>;
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  const preferred = resolvePostLoginShell(roles);

  if (shell === "admin" && preferred === "worker") {
    return <Navigate to={postLoginPath(roles, profile)} replace />;
  }

  // Worker shell intercept: block all routes until legal consent
  const onOnboarding =
    location.pathname === "/app/worker/onboarding" ||
    location.pathname.endsWith("/onboarding");

  if (
    shell === "worker" &&
    preferred === "worker" &&
    workerNeedsConsent(profile) &&
    !onOnboarding
  ) {
    return <Navigate to="/app/worker/onboarding" replace />;
  }

  // Already consented users should not stay on onboarding
  if (
    shell === "worker" &&
    preferred === "worker" &&
    !workerNeedsConsent(profile) &&
    onOnboarding
  ) {
    return <Navigate to="/app/worker/home" replace />;
  }

  return <>{children}</>;
}

export function RoleHomeRedirect() {
  const { user, loading, roles, profile } = useAuth();
  if (loading) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={postLoginPath(roles, profile)} replace />;
}
