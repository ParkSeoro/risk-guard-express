import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useIsMobile, isForceDesktop, setForceDesktop, prefersMobileAppShell } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminShellUser, isPureWorkerUser, MOBILE_ADMIN_HOME, WORKER_HOME } from "@/components/AuthGuard";

// Re-export for existing callers (MobileHome, AssessmentRunDetail, …)
export { setForceDesktop, isForceDesktop };

// Public / worker-native paths — never auto-bounce
const MOBILE_EXCLUDE = [
  /^\/app\/worker(\/|$)/,
  /^\/m(\/|$)/,
  /^\/auth/,
  /^\/login/,
  /^\/register/,
  /^\/forgot-password/,
  /^\/update-password/,
  /^\/reset-password/,
  /^\/consent/,
  /^\/onboarding/,
  /^\/worker\//,
  /^\/tbm\//,
  /^\/manual/,
  /^\/landing/,
  /^\/privacy/,
  /^\/z\//,
  /^\/c\//,
];

/**
 * Mobile UX helper:
 * - Pure workers → /app/worker/home
 * - Admins/managers on a phone → /app/worker/menu (mobile dashboard)
 *   Role state is NOT demoted — only the UI shell changes.
 * - forceDesktopUI=1 → leave them on /app/admin (responsive desktop)
 */
export default function MobileRedirectGuard() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, roles, rolesReady, isAuthLoading } = useAuth();

  useEffect(() => {
    if (!isMobile) return;
    if (typeof window !== "undefined" && window.innerWidth >= 768) return;
    if (isForceDesktop()) return;
    if (isAuthLoading || (user && !rolesReady)) return;

    const path = location.pathname;
    if (MOBILE_EXCLUDE.some((re) => re.test(path))) return;

    // Deep-link remaps (admin or legacy absolute → worker viewers)
    const ar =
      path.match(/^\/app\/admin\/assessment-run\/([^/]+)/) ||
      path.match(/^\/assessment-run\/([^/]+)/);
    if (ar) {
      navigate(`/app/worker/risk-assessment/${ar[1]}`, { replace: true });
      return;
    }
    const wp =
      path.match(/^\/app\/admin\/work-plan\/([^/]+)/) ||
      path.match(/^\/work-plan\/([^/]+)/);
    if (wp) {
      navigate(`/app/worker/work-plans/${wp[1]}`, { replace: true });
      return;
    }

    const isAdminPath = path.startsWith("/app/admin") || path === "/" || path === "";

    // Authenticated admin/manager on mobile → mobile admin dashboard
    if (user && isAdminShellUser(roles) && prefersMobileAppShell() && isAdminPath) {
      navigate(MOBILE_ADMIN_HOME, { replace: true });
      return;
    }

    // Pure workers (or anonymous) still bounce into worker shell
    if (user && !isPureWorkerUser(roles) && !isAdminShellUser(roles)) {
      // Empty / unknown roles: do not kidnap — leave alone (roles still hydrating)
      return;
    }
    if (user && isAdminShellUser(roles)) return;

    if (isAdminPath || !path.startsWith("/app/worker")) {
      navigate(WORKER_HOME, { replace: true });
    }
  }, [isMobile, location.pathname, navigate, user, roles, rolesReady, isAuthLoading]);

  return null;
}
