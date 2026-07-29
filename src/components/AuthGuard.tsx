/**
 * Role-based auth + traffic routing + universal consent intercept (/consent).
 * ALL authenticated users must complete consent once — except while ON /consent itself.
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

/** Auth / consent system paths — never redirect-loop these. */
export function isAuthSystemPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return (
    p === "/login" ||
    p === "/auth" ||
    p === "/register" ||
    p === "/consent" ||
    p === "/onboarding" ||
    p === "/forgot-password" ||
    p === "/update-password" ||
    p === "/reset-password"
  );
}

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
    // Column missing (pre-migration): don't permanently block after terms+privacy
    if (profile.agreed_to_admin_security == null) return false;
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
  const home = isAdminShellUser(roles) ? "/app/admin" : "/app/worker/home";
  // Never bounce back to root /
  return home === "/" ? "/app/admin" : home;
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

  // 1) Whitelist: consent / login / register must always render (no redirect loop)
  if (isAuthSystemPath(location.pathname)) {
    return <>{children}</>;
  }

  // 2) Don't deadlock forever — if loading stuck, still allow after rolesReady OR timeout handled in AuthContext
  if (loading && !rolesReady && !user) return <Loading />;
  if (user && loading && !rolesReady) return <Loading />;

  if (!user) {
    if (allowAnonymous) return <>{children}</>;
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  // Session known but roles still resolving — brief wait (AuthContext guarantees finally)
  if (!rolesReady) return <Loading />;

  // Universal consent for EVERY role — but never when already on /consent (whitelisted above)
  if (needsConsent(profile, roles)) {
    return <Navigate to="/consent" replace />;
  }

  if (shell === "admin" && isPureWorkerUser(roles)) {
    return <Navigate to="/app/worker/home" replace />;
  }

  return <>{children}</>;
}

export function RoleHomeRedirect() {
  const { user, loading, roles, rolesReady, profile } = useAuth();
  if (loading && !user) return <Loading />;
  if (user && !rolesReady && loading) return <Loading />;
  // If rolesReady never flips, AuthContext finally forces it — still proceed with best effort
  if (user && !rolesReady) return <Loading />;
  if (!user) return <Navigate to="/login" replace />;
  const dest = postLoginPath(roles, profile, { rolesReady });
  if (dest === "/" || dest === "") return <Navigate to="/login" replace />;
  return <Navigate to={dest} replace />;
}
