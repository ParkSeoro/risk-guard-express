import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";

const FORCE_DESKTOP_KEY = "forceDesktopUI";

// 모바일 기기에서 관리자(/app/admin) 진입 시 근로자 셸(/app/worker)로 이동
const MOBILE_EXCLUDE = [
  /^\/app\/worker(\/|$)/,
  /^\/m(\/|$)/, // legacy alias (redirects to /app/worker)
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

export default function MobileRedirectGuard() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isMobile) return;
    if (typeof window !== "undefined" && window.innerWidth >= 768) return;
    if (typeof window !== "undefined" && localStorage.getItem(FORCE_DESKTOP_KEY) === "1") return;
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

    // Admin shell or other desktop paths → worker home
    if (path.startsWith("/app/admin") || path === "/" || !path.startsWith("/app/worker")) {
      navigate("/app/worker", { replace: true });
    }
  }, [isMobile, location.pathname, navigate]);

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
