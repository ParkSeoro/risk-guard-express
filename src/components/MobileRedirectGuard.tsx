import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/contexts/AuthContext";
import { isAdminShellUser } from "@/components/AuthGuard";

const FORCE_DESKTOP_KEY = "forceDesktopUI";

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
  /^\/worker\//,
  /^\/tbm\//,
  /^\/manual/,
  /^\/landing/,
  /^\/privacy/,
  /^\/z\//,
  /^\/c\//,
];

/**
 * Mobile UX helper — MUST NOT kidnap authenticated admins/managers into worker onboarding.
 * Only pure workers (or anonymous) get bounced from /app/admin to /app/worker.
 */
export default function MobileRedirectGuard() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, roles, rolesReady, loading } = useAuth();

  useEffect(() => {
    if (!isMobile) return;
    if (typeof window !== "undefined" && window.innerWidth >= 768) return;
    if (typeof window !== "undefined" && localStorage.getItem(FORCE_DESKTOP_KEY) === "1") return;
    if (loading || (user && !rolesReady)) return;

    // Critical: admins/managers keep desktop admin shell even on small viewports
    if (user && isAdminShellUser(roles)) return;

    const path = location.pathname;

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

    if (MOBILE_EXCLUDE.some((re) => re.test(path))) return;

    if (path.startsWith("/app/admin") || path === "/" || !path.startsWith("/app/worker")) {
      navigate("/app/worker/home", { replace: true });
    }
  }, [isMobile, location.pathname, navigate, user, roles, rolesReady, loading]);

  return null;
}

export function setForceDesktop(on: boolean) {
  if (typeof window === "undefined") return;
  if (on) localStorage.setItem(FORCE_DESKTOP_KEY, "1");
  else localStorage.removeItem(FORCE_DESKTOP_KEY);
}

export function isForceDesktop(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(FORCE_DESKTOP_KEY) === "1";
}
