import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";

const FORCE_DESKTOP_KEY = "forceDesktopUI";

// 모바일 기기에서 데스크톱 페이지 진입 시 /m으로 자동 이동
// 예외: /m/*, /auth, /reset-password, /worker/*, /tbm/*, /manual
const MOBILE_EXCLUDE = [
  /^\/m(\/|$)/,
  /^\/auth/,
  /^\/reset-password/,
  /^\/worker\//,
  /^\/tbm\//,
  /^\/manual/,
  /^\/assessment-run\//,
  /^\/work-plan\//,
  /^\/worker-attendance/,
];

export default function MobileRedirectGuard() {
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isMobile) return;
    if (typeof window !== "undefined" && localStorage.getItem(FORCE_DESKTOP_KEY) === "1") return;
    const path = location.pathname;
    if (MOBILE_EXCLUDE.some((re) => re.test(path))) return;
    // 데스크톱 전용 경로 → 모바일 홈으로 이동
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
