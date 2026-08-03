import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Download, X, Share, Plus, MoreVertical, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { isNativeApp } from "@/lib/native/isNativeApp";

/** PWA install banner — browser/PWA only. Never show inside Capacitor shell. */
function isAllowedPath(pathname: string): boolean {
  if (isNativeApp()) return false;
  if (
    pathname === "/m" ||
    pathname.startsWith("/m/") ||
    pathname === "/auth" ||
    pathname.startsWith("/auth/") ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname.startsWith("/login/") ||
    pathname.startsWith("/register/")
  ) {
    return true;
  }
  if (pathname === "/app/worker" || pathname.startsWith("/app/worker/")) {
    return true;
  }
  return false;
}

type Platform = "android" | "ios" | "desktop";

function detectPlatform(): Platform {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return "ios";
  if (/android/i.test(ua)) return "android";
  return "desktop";
}

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as any).standalone === true
  );
}

function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

const DISMISS_KEY = "installPromptDismissedAt";
const DISMISS_HOURS = 24 * 7; // 7일

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [show, setShow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const platform = useMemo(detectPlatform, []);
  const inIframe = useMemo(isInIframe, []);
  const loc = useLocation();
  const allowed = isAllowedPath(loc.pathname);

  const deployUrl = useMemo(() => {
    const host = window.location.hostname;
    if (host.includes("lovableproject.com") || host.includes("id-preview--")) {
      return "https://safenex.org";
    }
    return window.location.origin;
  }, []);

  useEffect(() => {
    if (isStandalone()) return;
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_HOURS * 3600 * 1000) return;

    setShow(true);

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setShow(false);
  };

  /** Native install when available; otherwise open platform how-to (expected on iOS). */
  const install = async () => {
    if (deferred) {
      try {
        deferred.prompt();
        await deferred.userChoice;
        setShow(false);
        return;
      } catch {
        /* fall through to instructions */
      }
    }
    setExpanded(true);
    if (platform === "ios") {
      toast.message("Safari에서 공유 → 홈 화면에 추가를 눌러 주세요");
    } else if (platform === "android" && !deferred) {
      toast.message("Chrome 메뉴 → 앱 설치 / 홈 화면에 추가를 눌러 주세요");
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(deployUrl);
      toast.success("주소를 복사했습니다");
    } catch {
      toast.error("복사 실패 — 길게 눌러 복사하세요");
    }
  };

  const openUrl = () => window.open(deployUrl, "_blank", "noopener");

  const ctaLabel =
    deferred ? "설치"
    : platform === "ios" ? "설치 방법"
    : "설치 안내";

  if (!show || !allowed) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 max-w-md mx-auto bg-card border-2 border-primary rounded-xl shadow-2xl overflow-hidden">
      <div className="p-3 flex items-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary text-primary-foreground flex items-center justify-center shrink-0">
          <Download className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm">홈 화면에 앱 설치</div>
          <button
            onClick={copyUrl}
            className="text-xs text-muted-foreground truncate block w-full text-left hover:text-primary"
            title="주소 복사"
          >
            {deployUrl.replace(/^https?:\/\//, "")}
          </button>
        </div>
        <Button size="sm" onClick={() => void install()}>
          {ctaLabel}
        </Button>
        <Button size="icon" variant="ghost" onClick={dismiss} aria-label="닫기">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {expanded && (
        <div className="border-t bg-muted/40 p-3 space-y-3 text-sm">
          {inIframe && (
            <div className="rounded-md bg-warning/10 border border-warning/40 p-2 text-xs">
              편집기 미리보기에서는 설치할 수 없어요. 아래 주소를 모바일 브라우저에서 직접 열어주세요.
            </div>
          )}

          <div className="flex items-center gap-2">
            <code className="flex-1 px-2 py-1.5 bg-background border rounded text-xs truncate">
              {deployUrl}
            </code>
            <Button size="icon" variant="outline" onClick={copyUrl} aria-label="복사">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="outline" onClick={openUrl} aria-label="열기">
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          </div>

          {platform === "ios" && (
            <ol className="space-y-1.5 text-xs">
              <li className="flex items-center gap-2">
                1. Safari 하단의 <Share className="h-3.5 w-3.5 inline" /> 공유 버튼을 탭
              </li>
              <li className="flex items-center gap-2">
                2. <Plus className="h-3.5 w-3.5 inline" /> &quot;홈 화면에 추가&quot; 선택
              </li>
              <li>3. 우측 상단 &quot;추가&quot; 탭 → 홈 화면에 아이콘 생성</li>
            </ol>
          )}

          {platform === "android" && (
            <ol className="space-y-1.5 text-xs">
              <li className="flex items-center gap-2">
                1. Chrome 우측 상단 <MoreVertical className="h-3.5 w-3.5 inline" /> 메뉴
              </li>
              <li>2. &quot;앱 설치&quot; 또는 &quot;홈 화면에 추가&quot; 선택</li>
              <li>3. 안내에 따라 설치 완료</li>
            </ol>
          )}

          {platform === "desktop" && (
            <ol className="space-y-1.5 text-xs">
              <li>1. Chrome/Edge 주소창 오른쪽의 설치 아이콘 클릭</li>
              <li>2. 또는 메뉴 → &quot;앱 설치&quot; 선택</li>
              <li>3. 모바일 사용 시: 위 주소를 휴대폰 브라우저에서 여세요</li>
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
