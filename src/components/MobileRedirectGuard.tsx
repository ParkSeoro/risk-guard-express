import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  useIsMobile,
  isForceDesktop,
  setForceDesktop,
  prefersMobileAppShell,
  isLikelyPhoneDevice,
} from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminShellUser, isPureWorkerUser, MOBILE_ADMIN_HOME, WORKER_HOME } from "@/components/AuthGuard";
import { toMobileShellPath } from "@/lib/notificationRoutes";

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
  /^\/native-permissions/,
  /^\/onboarding/,
  /^\/worker\//,
  /^\/tbm\//,
  /^\/manual/,
  /^\/landing/,
  /^\/privacy/,
  /^\/z\//,
  /^\/c\//,
];

const REMAP_PREFIXES = [
  "/app/admin",
  "/assessment-run",
  "/work-plan",
  "/approvals",
  "/work-permits",
  "/work-plans",
  "/risk-assessment",
  "/safety-inspections",
  "/incidents",
  "/tbm",
  "/work-stop",
  "/workers",
];

/**
 * Mobile UX helper:
 * - Pure workers → /app/worker/home
 * - Admins/managers on a phone → /app/worker/menu (mobile dashboard)
 *   Role state is NOT demoted — only the UI shell changes.
 * - forceDesktopUI=1 → leave them on /app/admin (responsive desktop)
 */
export default function MobileRedirectGuard() {
  const isMobileWidth = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, roles, rolesReady, isAuthLoading } = useAuth();

  useEffect(() => {
    // Prefer phone UA / coarse pointer over CSS width alone (landscape / desktop-site)
    if (!prefersMobileAppShell()) return;
    if (!(isMobileWidth || isLikelyPhoneDevice())) return;
    if (isForceDesktop()) return;
    // Wait for roles before choosing admin vs worker home (avoid desktop flash)
    if (isAuthLoading || (user && !rolesReady)) return;

    const path = location.pathname;
    if (MOBILE_EXCLUDE.some((re) => re.test(path))) return;

    const needsRemap = REMAP_PREFIXES.some(
      (p) => path === p || path.startsWith(p + "/") || path.startsWith(p + "?"),
    );
    if (needsRemap) {
      const canonical = path.startsWith("/app/")
        ? path
        : `/app/admin${path.startsWith("/") ? path : `/${path}`}`;
      const remapped = toMobileShellPath(canonical);
      if (remapped.startsWith("/app/worker") && remapped !== path) {
        navigate(remapped + (location.search || ""), { replace: true });
        return;
      }
    }

    const isAdminPath = path.startsWith("/app/admin") || path === "/" || path === "";

    // Authenticated admin/manager on mobile → mobile admin dashboard
    if (user && isAdminShellUser(roles) && isAdminPath) {
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
  }, [
    isMobileWidth,
    location.pathname,
    location.search,
    navigate,
    user,
    roles,
    rolesReady,
    isAuthLoading,
  ]);

  return null;
}
