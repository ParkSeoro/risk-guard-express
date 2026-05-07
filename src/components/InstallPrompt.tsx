import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, X } from "lucide-react";

// PWA 설치 안내 (Android Chrome). iOS는 별도 안내 텍스트.
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [show, setShow] = useState(false);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (localStorage.getItem("installPromptDismissed") === "1") return;
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone;
    if (standalone) return;
    if (isIOS) {
      setIosHint(true);
      setShow(true);
      return;
    }
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const dismiss = () => {
    localStorage.setItem("installPromptDismissed", "1");
    setShow(false);
  };

  const install = async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    setShow(false);
  };

  if (!show) return null;

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 max-w-md mx-auto bg-card border-2 border-primary rounded-lg shadow-lg p-3 flex items-center gap-3">
      <div className="h-10 w-10 rounded bg-primary text-primary-foreground flex items-center justify-center shrink-0">
        <Download className="h-5 w-5" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm">앱으로 설치</div>
        <div className="text-xs text-muted-foreground">
          {iosHint ? "공유 → '홈 화면에 추가'" : "홈 화면에 추가하여 빠르게 사용"}
        </div>
      </div>
      {!iosHint && (
        <Button size="sm" onClick={install}>설치</Button>
      )}
      <Button size="icon" variant="ghost" onClick={dismiss}><X className="h-4 w-4" /></Button>
    </div>
  );
}
