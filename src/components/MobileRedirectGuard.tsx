import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";

const FORCE_DESKTOP_KEY = "forceDesktopUI";

// 모바일 기기에서 데스크톱 페이지 진입 시 /m으로 자동 이동
// 예외: /m/*, /auth, /reset-password, /worker/*, /tbm/*, /manual
// 위험성평가·작업계획 상세는 모바일 Viewer 경로로 리다이렉트
const MOBILE_EXCLUDE = [
  /^\/m(\/|$)/,
  /^\/auth/,
  /^\/forgot-password/,
  /^\/update-password/,
  /^\/reset-password/,
  /^\/worker\//,
  /^\/tbm\//,
  /^\/manual/,
  /^\/worker-attendance/,
  /^\/landing/,
  /^\/privacy/,
  /^\/$/,
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

    const ar = path.match(/^\/assessment-run\/([^/]+)/);
    if (ar) {
      navigate(`/m/risk-assessment/${ar[1]}`, { replace: true });
      return;
    }
    const wp = path.match(/^\/work-plan\/([^/]+)/);
    if (wp) {
      navigate(`/m/work-plans/${wp[1]}`, { replace: true });
      return;
    }

    if (MOBILE_EXCLUDE.some((re) => re.test(path))) return;
    navigate("/m", { replace: true });
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
