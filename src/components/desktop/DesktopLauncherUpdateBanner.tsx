import { useEffect, useState } from "react";
import { Download, Loader2, RefreshCw, Sparkles, X } from "lucide-react";
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
 * `.exe` launcher version is published. On v1.1.9+, pre-downloads the installer
 * in the background so one click runs silent install & relaunch.
 */
export function DesktopLauncherUpdateBanner() {
  const [installedVersion, setInstalledVersion] = useState<string | null>(null);
  const [preparedPath, setPreparedPath] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isWindowsDesktopApp()) return;
    let cancelled = false;

    void getDesktopVersionInfo().then(async (info) => {
      if (cancelled || !info?.appVersion) return;
      if (!isOtaUpdateAvailable(PC_APP_VERSION, info.appVersion)) return;

      setInstalledVersion(info.appVersion.replace(/^v/i, ""));

      const prepare = window.safenexDesktop?.prepareLauncherUpdate;
      if (prepare) {
        setDownloading(true);
        try {
          const res = await prepare({
            url: PC_DOWNLOAD_URL,
            version: PC_APP_VERSION.replace(/^v/i, ""),
          });
          if (!cancelled && res?.ready && res.filePath) {
            setPreparedPath(res.filePath);
          }
        } finally {
          if (!cancelled) setDownloading(false);
        }
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!isWindowsDesktopApp() || !installedVersion || dismissed) {
    return null;
  }

  const handleInstallClick = async () => {
    const installFn = window.safenexDesktop?.installLauncherUpdate;
    if (preparedPath && installFn) {
      setInstalling(true);
      const res = await installFn({ filePath: preparedPath });
      if (!res?.ok) {
        setInstalling(false);
        openExternalUrl(PC_DOWNLOAD_URL);
        toast.info("자동 설치를 시작하지 못해 다운로드 페이지로 전환합니다.");
      }
      return;
    }

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
          {downloading || installing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold truncate">
            {preparedPath
              ? `PC 런처 ${PC_APP_VERSION} 업데이트 준비 완료`
              : downloading
                ? `PC 런처 ${PC_APP_VERSION} 백그라운드 다운로드 중...`
                : `PC 런처 새 버전(${PC_APP_VERSION}) 출시 · 현재 v${installedVersion}`}
          </p>
          <p className="text-[11px] opacity-85 truncate">
            {preparedPath
              ? "버튼을 누르면 자동으로 설치 후 다시 실행됩니다."
              : "중복 실행 방지 등 런처 개선을 위해 새 버전 업데이트가 필요합니다."}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <Button
          type="button"
          size="sm"
          disabled={downloading || installing}
          onClick={() => void handleInstallClick()}
          className="h-7 px-2.5 text-xs gap-1 bg-amber-600 hover:bg-amber-700 text-white"
        >
          {preparedPath ? (
            <>
              <RefreshCw className="h-3 w-3" />
              <span>{installing ? "설치 중..." : "업데이트하기"}</span>
            </>
          ) : (
            <>
              <Download className="h-3 w-3" />
              <span>{downloading ? "받는 중..." : "바로 설치"}</span>
            </>
          )}
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
