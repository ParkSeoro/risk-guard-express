/**
 * Role-based auth + traffic routing + universal consent intercept (/consent).
 * AuthGuard never talks to the DB — only reads useAuth() state (waterfall).
 */
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import type { ReactNode } from "react";
import { prefersMobileAppShell } from "@/hooks/use-mobile";
import { isActiveMobilePreviewRequest } from "@/lib/mobilePreview";
import {
  hasCompletedNativePermissions,
  isNativeApp,
} from "@/lib/native/isNativeApp";
import { isAccountLoginBlocked, isAccountPending } from "@/lib/accountStatus";

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

/** Mobile Today home — role-specific (worker vs manager). Roles stay as-is. */
export const MOBILE_ADMIN_HOME = "/app/worker/today";
export const WORKER_HOME = "/app/worker/today";
export const DESKTOP_ADMIN_HOME = "/app/admin";

/** Public auth/consent paths — AuthGuard always passes these through. */
export const PUBLIC_ROUTES = [
  "/login",
  "/auth",
  "/register",
  "/consent",
  "/native-permissions",
  "/onboarding",
  "/forgot-password",
  "/update-password",
  "/reset-password",
] as const;

/** Auth / consent system paths — never redirect-loop these. */
export function isAuthSystemPath(pathname: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return (PUBLIC_ROUTES as readonly string[]).includes(p);
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
export function needsConsent(
  profile: ConsentProfile,
  roles: string[],
  opts?: { loginIntent?: "admin" | "worker" | null },
): boolean {
  if (!profile) return true;
  if (profile.agreed_to_terms !== true) return true;
  if (profile.agreed_to_privacy !== true) return true;
  if (!profile.consent_agreed_at) return true;

  const shell = resolvePostLoginShell(roles, {
    rolesReady: true,
    loginIntent: opts?.loginIntent ?? readLoginIntent(),
  });

  if (shell === "admin" || isAdminShellUser(roles)) {
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

export function postConsentHomePath(
  roles: string[],
  opts?: { rolesReady?: boolean; loginIntent?: "admin" | "worker" | null },
): string {
  const shell = resolvePostLoginShell(roles, {
    rolesReady: opts?.rolesReady ?? true,
    loginIntent: opts?.loginIntent ?? readLoginIntent(),
  });
  if (shell === "worker") return WORKER_HOME;
  // Admin/manager roles: on phone → mobile app shell (role state unchanged)
  if (prefersMobileAppShell()) return MOBILE_ADMIN_HOME;
  return DESKTOP_ADMIN_HOME;
}

export function postLoginPath(
  roles: string[],
  profile?: ConsentProfile,
  opts?: { rolesReady?: boolean; loginIntent?: "admin" | "worker" | null },
): string {
  const intent = opts?.loginIntent ?? readLoginIntent();
  if (needsConsent(profile ?? null, roles, { loginIntent: intent })) return "/consent";
  return postConsentHomePath(roles, {
    rolesReady: opts?.rolesReady,
    loginIntent: intent,
  });
}

type AuthGuardProps = {
  children: ReactNode;
  shell: ShellKind;
  allowAnonymous?: boolean;
};

function LoadingSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
      세션 확인 중…
    </div>
  );
}

function AccountBlockedScreen({
  title,
  body,
  destructive = true,
}: {
  title: string;
  body: string;
  destructive?: boolean;
}) {
  const { signOut } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="text-center space-y-4 max-w-md">
        <h2 className={`text-xl font-bold ${destructive ? "text-destructive" : ""}`}>{title}</h2>
        <p className="text-sm text-muted-foreground">{body}</p>
        <button
          type="button"
          className="text-sm text-accent hover:underline"
          onClick={() => void signOut()}
        >
          로그아웃
        </button>
      </div>
    </div>
  );
}

/**
 * Strict waterfall (no DB):
 * ① isAuthLoading → spinner
 * ② PUBLIC_ROUTES → pass
 * ③ !session → /login
 * ④ needsConsent → /consent
 * ⑤ shell mismatch → correct home; else children
 */
export default function AuthGuard({ children, shell, allowAnonymous = false }: AuthGuardProps) {
  const { user, session, isAuthLoading, roles, rolesReady, profile } = useAuth();
  const location = useLocation();

  // ① Global auth bootstrap
  if (isAuthLoading) return <LoadingSpinner />;

  const status = (profile as { account_status?: string | null } | null)?.account_status;
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const onAuthPage = path === "/login" || path === "/auth" || path === "/register";
  if (session && !onAuthPage) {
    if (isAccountPending(status)) {
      return (
        <AccountBlockedScreen
          title="승인 대기 중"
          body="관리자가 계정을 승인한 후에 시스템을 이용하실 수 있습니다."
          destructive={false}
        />
      );
    }
    if (isAccountLoginBlocked(status)) {
      return (
        <AccountBlockedScreen
          title="로그인 차단된 계정"
          body="이 계정은 관리자가 로그인을 차단했습니다. 다른 아이디로 접속하지 말고 관리자에게 재활성화를 요청하세요."
        />
      );
    }
  }

  // ② Public auth/consent routes always render
  if (isAuthSystemPath(location.pathname)) {
    return <>{children}</>;
  }

  // ③ No session
  if (!session && !user) {
    if (allowAnonymous) return <>{children}</>;
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  // Brief wait if signed in but roles still resolving (post-login hydrate).
  // Keep showing the shell once we already have roles — avoids full-tree flicker
  // when a same-user auth event briefly clears rolesReady.
  if (!rolesReady && roles.length === 0) return <LoadingSpinner />;

  // ④ Consent required
  if (needsConsent(profile, roles)) {
    return <Navigate to="/consent" replace />;
  }

  // ④b Native OS permissions (after legal consent, once)
  if (
    isNativeApp() &&
    !hasCompletedNativePermissions() &&
    location.pathname !== "/native-permissions"
  ) {
    return <Navigate to="/native-permissions" replace />;
  }

  // ⑤ Shell gate — only pure workers are blocked from admin shell
  if (shell === "admin" && isPureWorkerUser(roles)) {
    return <Navigate to={WORKER_HOME} replace />;
  }
  // Admins may use the worker/mobile shell on phones (UI only — roles stay admin).
  // Desktop (or forceDesktop) still keeps managers on /app/admin —
  // except master PC mobile preview (iframe / ?mobilePreview=1).
  if (shell === "worker" && isAdminShellUser(roles) && !prefersMobileAppShell()) {
    const isMaster = roles.some((r) => r.toLowerCase() === "master");
    if (isMaster && isActiveMobilePreviewRequest(location.search)) {
      return <>{children}</>;
    }
    return <Navigate to={DESKTOP_ADMIN_HOME} replace />;
  }

  return <>{children}</>;
}

export function RoleHomeRedirect() {
  const { user, session, isAuthLoading, roles, rolesReady, profile } = useAuth();
  if (isAuthLoading) return <LoadingSpinner />;
  if (!session && !user) return <Navigate to="/login" replace />;
  if (!rolesReady) return <LoadingSpinner />;
  const dest = postLoginPath(roles, profile, { rolesReady });
  if (dest === "/" || dest === "") return <Navigate to="/login" replace />;
  return <Navigate to={dest} replace />;
}
