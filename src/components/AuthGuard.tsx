/**
 * Role-based auth + traffic routing + universal consent intercept (/consent).
 * ALL authenticated users (admin / manager / worker) must complete consent once.
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

export function isPureWorkerUser(roles: string[]): boolean {
  if (isAdminShellUser(roles)) return false;
  const set = new Set(roles.map((r) => r.toLowerCase()));
  return WORKER_SHELL_ROLES.some((r) => set.has(r));
}

export function resolvePostLoginShell(
  roles: string[],
  opts?: { rolesReady?: boolean; loginIntent?: "admin" | "worker" | null },
): ShellKind {
  if (isAdminShellUser(roles)) return "admin";
  if (isPureWorkerUser(roles)) return "worker";
  if (opts?.rolesReady === false) {
    if (opts.loginIntent === "worker") return "worker";
    return "admin";
  }
  if (opts?.loginIntent === "worker") return "worker";
  return "admin";
}

type ConsentProfile = {
  agreed_to_terms?: boolean | null;
  agreed_to_location?: boolean | null;
  agreed_to_privacy?: boolean | null;
  agreed_to_admin_security?: boolean | null;
  consent_agreed_at?: string | null;
} | null;

/** Universal consent gate — role-aware required flags. */
export function needsConsent(profile: ConsentProfile, roles: string[]): boolean {
  if (!profile) return true;
  if (profile.agreed_to_terms !== true) return true;
  if (profile.agreed_to_privacy !== true) return true;
  if (!profile.consent_agreed_at) return true;

  if (isAdminShellUser(roles)) {
    return profile.agreed_to_admin_security !== true;
  }
  return profile.agreed_to_location !== true;
}

/** @deprecated use needsConsent */
export function workerNeedsConsent(profile: ConsentProfile): boolean {
  return needsConsent(profile, ["worker"]);
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

export function postConsentHomePath(roles: string[]): string {
  return isAdminShellUser(roles) ? "/app/admin" : "/app/worker/home";
}

export function postLoginPath(
  roles: string[],
  profile?: ConsentProfile,
  _opts?: { rolesReady?: boolean },
): string {
  if (needsConsent(profile ?? null, roles)) return "/consent";
  return postConsentHomePath(roles);
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

  // Universal consent for EVERY role (admin / manager / worker)
  if (needsConsent(profile, roles)) {
    return <Navigate to="/consent" replace />;
  }

  const pureWorker = isPureWorkerUser(roles);

  if (shell === "admin" && pureWorker) {
    return <Navigate to="/app/worker/home" replace />;
  }

  return <>{children}</>;
}

export function RoleHomeRedirect() {
  const { user, loading, roles, rolesReady, profile } = useAuth();
  if (loading || (user && !rolesReady)) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={postLoginPath(roles, profile, { rolesReady })} replace />;
}
