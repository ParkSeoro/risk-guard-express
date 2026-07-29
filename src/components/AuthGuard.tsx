/**
 * Role-based auth + traffic routing.
 * Consent intercept applies ONLY to pure WORKER users — never admins/managers.
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

export function isAdminShellUser(roles: string[]): boolean {
  const set = new Set(roles.map((r) => r.toLowerCase()));
  return ADMIN_SHELL_ROLES.some((r) => set.has(r));
}

/** True only when user has worker/viewer and NO admin/manager roles. */
export function isPureWorkerUser(roles: string[]): boolean {
  if (isAdminShellUser(roles)) return false;
  const set = new Set(roles.map((r) => r.toLowerCase()));
  return WORKER_SHELL_ROLES.some((r) => set.has(r));
}

/**
 * Resolve destination shell.
 * Empty roles while still loading must NOT default to worker (that hijacks admins).
 */
export function resolvePostLoginShell(
  roles: string[],
  opts?: { rolesReady?: boolean; loginIntent?: "admin" | "worker" | null },
): ShellKind {
  if (isAdminShellUser(roles)) return "admin";
  if (isPureWorkerUser(roles)) return "worker";

  // Roles not ready yet — honor login tab intent if present
  if (opts?.rolesReady === false) {
    if (opts.loginIntent === "admin") return "admin";
    if (opts.loginIntent === "worker") return "worker";
    return "admin"; // safe default for unknown: admin desktop, never onboarding
  }

  // Roles fetched but empty: prefer admin path (project gate handles membership)
  if (opts?.loginIntent === "worker") return "worker";
  return "admin";
}

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

export function readLoginIntent(): "admin" | "worker" | null {
  try {
    const v = sessionStorage.getItem("login_shell_intent");
    if (v === "admin" || v === "worker") return v;
  } catch {
    /* ignore */
  }
  return null;
}

export function writeLoginIntent(intent: "admin" | "worker") {
  try {
    sessionStorage.setItem("login_shell_intent", intent);
  } catch {
    /* ignore */
  }
}

export function postLoginPath(
  roles: string[],
  profile?: {
    agreed_to_location?: boolean | null;
    agreed_to_terms?: boolean | null;
    agreed_to_privacy?: boolean | null;
  } | null,
  opts?: { rolesReady?: boolean },
): string {
  const shell = resolvePostLoginShell(roles, {
    rolesReady: opts?.rolesReady,
    loginIntent: readLoginIntent(),
  });

  // ADMIN / MANAGER → desktop admin dashboard (never onboarding)
  if (shell === "admin") return "/app/admin";

  // WORKER only → consent gate
  if (isPureWorkerUser(roles) && workerNeedsConsent(profile ?? null)) {
    return "/app/worker/onboarding";
  }
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
  const { user, loading, roles, rolesReady, profile } = useAuth();
  const location = useLocation();

  if (loading || (user && !rolesReady)) return <Loading />;

  if (!user) {
    if (allowAnonymous) return <>{children}</>;
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  const admin = isAdminShellUser(roles);
  const pureWorker = isPureWorkerUser(roles);
  const preferred = resolvePostLoginShell(roles, {
    rolesReady,
    loginIntent: readLoginIntent(),
  });

  // ——— Admin / manager shell ———
  if (shell === "admin") {
    // Pure workers may not live in admin shell
    if (pureWorker) {
      return <Navigate to={postLoginPath(roles, profile, { rolesReady })} replace />;
    }
    // Admins/managers always pass — NEVER send to worker onboarding
    return <>{children}</>;
  }

  // ——— Worker shell ———
  // Admins opening /app/worker/* are allowed (field use) but skip consent
  if (admin) {
    return <>{children}</>;
  }

  // Consent intercept: ONLY pure WORKER role
  const onOnboarding =
    location.pathname === "/app/worker/onboarding" || location.pathname.endsWith("/onboarding");

  if (pureWorker && workerNeedsConsent(profile) && !onOnboarding) {
    return <Navigate to="/app/worker/onboarding" replace />;
  }

  if (pureWorker && !workerNeedsConsent(profile) && onOnboarding) {
    return <Navigate to="/app/worker/home" replace />;
  }

  // Non-worker / unknown on worker shell: if preferred admin, bounce to admin
  if (!pureWorker && preferred === "admin" && !onOnboarding) {
    return <Navigate to="/app/admin" replace />;
  }

  return <>{children}</>;
}

export function RoleHomeRedirect() {
  const { user, loading, roles, rolesReady, profile } = useAuth();
  if (loading || (user && !rolesReady)) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={postLoginPath(roles, profile, { rolesReady })} replace />;
}
