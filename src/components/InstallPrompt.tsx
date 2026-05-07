import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Download, X, Share, Plus, MoreVertical, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

// 설치 안내 배너는 모바일 홈(/m) 과 로그인(/auth) 화면에서만 노출 — 한 곳에 고정
const ALLOWED_PATHS = ["/m", "/auth"];

// PWA 설치 안내 배너 — 플랫폼별 안내 + 현재 배포 주소 링크
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
  try { return window.self !== window.top; } catch { return true; }
}

const DISMISS_KEY = "installPromptDismissedAt";
const DISMISS_HOURS = 24;

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [show, setShow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const platform = useMemo(detectPlatform, []);
  const inIframe = useMemo(isInIframe, []);

  // 배포 주소 (iframe 안이면 top 주소 추정 불가 → 알려진 호스트 우선순위)
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

  const install = async () => {
    if (!deferred) {
      setExpanded(true);
      return;
    }
    deferred.prompt();
    await deferred.userChoice;
    setShow(false);
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

  if (!show) return null;

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
        <Button size="sm" onClick={() => { install(); setExpanded(true); }}>
          설치
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
                2. <Plus className="h-3.5 w-3.5 inline" /> "홈 화면에 추가" 선택
              </li>
              <li>3. 우측 상단 "추가" 탭 → 홈 화면에 아이콘 생성</li>
            </ol>
          )}

          {platform === "android" && (
            <ol className="space-y-1.5 text-xs">
              <li className="flex items-center gap-2">
                1. Chrome 우측 상단 <MoreVertical className="h-3.5 w-3.5 inline" /> 메뉴
              </li>
              <li>2. "앱 설치" 또는 "홈 화면에 추가" 선택</li>
              <li>3. 안내에 따라 설치 완료</li>
            </ol>
          )}

          {platform === "desktop" && (
            <ol className="space-y-1.5 text-xs">
              <li>1. Chrome/Edge 주소창 오른쪽의 설치 아이콘 클릭</li>
              <li>2. 또는 메뉴 → "앱 설치" 선택</li>
              <li>3. 모바일 사용 시: 위 주소를 휴대폰 브라우저에서 여세요</li>
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
