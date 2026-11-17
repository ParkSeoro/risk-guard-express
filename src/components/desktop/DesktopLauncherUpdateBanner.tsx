import { useEffect, useState } from "react";
import { Download, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getDesktopVersionInfo,
  isWindowsDesktopApp,
  openExternalUrl,
} from "@/lib/desktopBridge";
import { isOtaUpdateAvailable } from "@/lib/otaVersion";
import { PC_APP_VERSION, PC_DOWNLOAD_URL } from "@/pages/Download";
import { toast } from "sonner";

/**
 * Displays a top banner inside the Windows Desktop Launcher when a newer native
 * `.exe` launcher version is published (OTA updates web bundle only, not Electron main.cjs).
 */
export function DesktopLauncherUpdateBanner() {
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isWindowsDesktopApp()) return;
    let cancelled = false;
    void getDesktopVersionInfo().then((info) => {
      if (cancelled || !info?.appVersion) return;
      if (isOtaUpdateAvailable(info.appVersion, PC_APP_VERSION)) {
        setInstalledVersion(info.appVersion.replace(/^v/i, ""));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!isWindowsDesktopApp() || !installedVersion || dismissed) {
    return null;
  }

  const handleInstallClick = () => {
    openExternalUrl(PC_DOWNLOAD_URL);
    toast.success("설치 파일 다운로드를 시작합니다", {
      description:
        "내려받은 SafeNex_PC_Setup.exe를 실행하시면 기존 설정 그대로 덮어쓰기 업데이트됩니다.",
      duration: 7000,
    });
  };

  return (
    <div
      role="status"
      className="shrink-0 px-3 py-2 bg-amber-500/15 border-b border-amber-500/30 text-amber-950 dark:text-amber-100 flex flex-wrap items-center justify-between gap-2"
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <div className="h-6 w-6 rounded-full bg-amber-500/25 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
          <Sparkles className="h-3.5 w-3.5" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold truncate">
            PC 런처 새 버전({PC_APP_VERSION}) 출시 · 현재 v{installedVersion}
          </p>
          <p className="text-[11px] opacity-85 truncate">
            중복 실행 방지 등 런처 개선을 위해 새 설치 파일로 덮어쓰기 설치가 필요합니다.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button
          type="button"
          size="sm"
          onClick={handleInstallClick}
          className="h-7 px-2.5 text-xs gap-1 bg-amber-600 hover:bg-amber-700 text-white"
        >
          <Download className="h-3 w-3" />
          <span>바로 설치</span>
        </Button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="p-1 rounded hover:bg-amber-500/20 text-amber-800 dark:text-amber-200"
          title="닫기"
          aria-label="업데이트 배너 닫기"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
