import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Monitor,
  Download,
  Power,
  KeyRound,
  BellRing,
  Pin,
  Columns2,
  Smartphone,
  ExternalLink,
  CheckCircle2,
  ShieldCheck,
  Sparkles,
  Laptop,
  RefreshCw,
} from "lucide-react";
import {
  checkAndApplyDesktopOtaUpdate,
  getDesktopVersionInfo,
  isWindowsDesktopApp,
  loadDesktopSettings,
  saveDesktopSettings,
  applyDesktopWindowMode,
  DESKTOP_DEFAULT_VERSION,
  type DesktopAppSettings,
} from "@/lib/desktopBridge";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

interface DesktopAppSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettingsChanged?: (settings: DesktopAppSettings) => void;
}

const WINDOWS_INSTALLER_RELEASE_URL =
  "https://github.com/ParkSeoro/risk-guard-express/releases/latest";

export function DesktopAppSettingsDialog({
  open,
  onOpenChange,
  onSettingsChanged,
}: DesktopAppSettingsDialogProps) {
  const navigate = useNavigate();
  const isNativeDesktop = isWindowsDesktopApp();
  const [settings, setSettings] = useState<DesktopAppSettings>(() =>
    loadDesktopSettings(),
  );
  const [deferredPwaPrompt, setDeferredPwaPrompt] = useState<any>(null);
  const [versionInfo, setVersionInfo] = useState<{
    appVersion: string;
    bundleVersion: string;
  }>({ appVersion: DESKTOP_DEFAULT_VERSION, bundleVersion: DESKTOP_DEFAULT_VERSION });
  const [checkingOta, setCheckingOta] = useState(false);

  useEffect(() => {
    if (open) {
      setSettings(loadDesktopSettings());
      void getDesktopVersionInfo().then(setVersionInfo);
    }
  }, [open]);

  const handleManualOtaCheck = async () => {
    setCheckingOta(true);
    try {
      const res = await checkAndApplyDesktopOtaUpdate();
      const updatedInfo = await getDesktopVersionInfo();
      setVersionInfo(updatedInfo);
      if (res.pendingRestart) {
        toast.success(res.message);
      } else if (res.ok) {
        toast.info(res.message);
      } else {
        toast.error(res.message);
      }
    } finally {
      setCheckingOta(false);
    }
  };

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPwaPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const updateSetting = <K extends keyof DesktopAppSettings>(
    key: K,
    value: DesktopAppSettings[K],
  ) => {
    const next = saveDesktopSettings({ [key]: value });
    setSettings(next);
    onSettingsChanged?.(next);
    if (key === "defaultWindowMode") {
      applyDesktopWindowMode(value as "compact" | "expanded");
    }
    toast.success("데스크톱 환경설정이 저장되었습니다.");
  };

  const handleInstallWebApp = async () => {
    if (deferredPwaPrompt) {
      deferredPwaPrompt.prompt();
      const choice = await deferredPwaPrompt.userChoice;
      if (choice?.outcome === "accepted") {
        toast.success("PC 바탕화면에 SafeNex 바로가기 앱이 설치되었습니다.");
      }
      setDeferredPwaPrompt(null);
      return;
    }
    window.open(WINDOWS_INSTALLER_RELEASE_URL, "_blank", "noopener,noreferrer");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-32px)] max-w-[480px] max-h-[88vh] overflow-y-auto p-4 sm:p-5">
        <DialogHeader className="pb-1">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <Monitor className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-sm font-bold flex items-center gap-2">
                <span className="truncate">PC 데스크톱 메신저 설정</span>
                {isNativeDesktop ? (
                  <Badge className="bg-emerald-600 text-white text-[10px] shrink-0">
                    Windows PC
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-[10px] shrink-0">
                    웹 모드
                  </Badge>
                )}
              </DialogTitle>
              <DialogDescription className="text-[11px] mt-0.5 truncate">
                자동 실행, 로그인 세션 유지 및 알림 환경을 설정합니다.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* 1. Windows .exe 설치 안내 배너 (웹 접속 시 표시) */}
          {!isNativeDesktop && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-3.5 space-y-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
                    <Laptop className="h-4 w-4" />
                    <span>Windows 전용 실행 파일 (.exe) 및 PC 워크스페이스</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    PC 부팅 시 자동 실행, 작업표시줄 트레이 상주, 화면 캡처(`Ctrl+V`) 즉시 전송,
                    새 창 팝아웃을 지원하는 Windows 데스크톱 버전입니다.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 text-xs gap-1.5 flex-1"
                  onClick={() => {
                    onOpenChange(false);
                    navigate("/app/admin/desktop-workspace");
                  }}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>카톡형 PC 워크스페이스 바로 열기</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs gap-1.5"
                  onClick={() => void handleInstallWebApp()}
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Windows .exe 다운로드</span>
                  <ExternalLink className="h-3 w-3 opacity-60" />
                </Button>
              </div>
            </div>
          )}

          {/* 2. 시작 및 로그인 설정 (카톡 PC 스타일) */}
          <div className="rounded-xl border bg-card p-3.5 space-y-3">
            <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Power className="h-3.5 w-3.5 text-primary" />
              <span>시작 및 자동 로그인</span>
            </h4>

            <div className="flex items-center justify-between gap-3 py-1">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium cursor-pointer">
                  윈도우 시작 시 자동 실행
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  컴퓨터를 켜면 SafeNex PC 메신저가 자동으로 시작됩니다.
                </p>
              </div>
              <Switch
                checked={settings.autoStartOnBoot}
                onCheckedChange={(v) => updateSetting("autoStartOnBoot", v)}
              />
            </div>

            <div className="flex items-center justify-between gap-3 py-1 border-t pt-2.5">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium cursor-pointer flex items-center gap-1.5">
                  <KeyRound className="h-3 w-3 text-primary" />
                  <span>자동 로그인 (로그인 정보 저장)</span>
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  PC 재부팅 후에도 다시 로그인할 필요 없이 세션을 유지합니다.
                </p>
              </div>
              <Switch
                checked={settings.keepLoggedIn}
                onCheckedChange={(v) => updateSetting("keepLoggedIn", v)}
              />
            </div>

            <div className="flex items-center justify-between gap-3 py-1 border-t pt-2.5">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium cursor-pointer">
                  로그인 후 카톡형 통합 워크스페이스로 바로 시작
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  로그인 직후 대화목록·조직도·주요 업무가 결합된 화면으로 이동합니다.
                </p>
              </div>
              <Switch
                checked={settings.launchMessengerWorkspaceOnLogin}
                onCheckedChange={(v) =>
                  updateSetting("launchMessengerWorkspaceOnLogin", v)
                }
              />
            </div>

            <div className="flex items-center justify-between gap-3 py-1 border-t pt-2.5">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium cursor-pointer">
                  창 닫기(X) 시 종료하지 않고 트레이로 최소화
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  우측 하단 시계 옆 시스템 트레이에서 실시간 무전·결재 알림을 계속 받습니다.
                </p>
              </div>
              <Switch
                checked={settings.minimizeToTrayOnClose}
                onCheckedChange={(v) => updateSetting("minimizeToTrayOnClose", v)}
              />
            </div>
            <div className="flex items-center justify-between gap-3 py-1 border-t pt-2.5">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium cursor-pointer flex items-center gap-1.5">
                  <Pin className="h-3 w-3 text-primary" />
                  <span>창 항상 위에 고정 (Always on Top)</span>
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  엑셀·CAD 작업 중에도 SafeNex 창이 가려지지 않게 유지합니다.
                </p>
              </div>
              <Switch
                checked={settings.alwaysOnTop}
                onCheckedChange={(v) => updateSetting("alwaysOnTop", v)}
              />
            </div>
          </div>

          {/* 3. 알림 설정 */}
          <div className="rounded-xl border bg-card p-3.5 space-y-2.5">
            <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <BellRing className="h-3.5 w-3.5 text-primary" />
              <span>작업표시줄 및 알림 배너</span>
            </h4>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className="text-xs font-medium cursor-pointer">
                  우측 하단 알림 팝업 및 작업표시줄 아이콘 깜빡임
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  새 대화나 결재 요청 도착 시 Windows 네이티브 알림을 표시합니다.
                </p>
              </div>
              <Switch
                checked={settings.desktopNotificationBanner}
                onCheckedChange={(v) =>
                  updateSetting("desktopNotificationBanner", v)
                }
              />
            </div>
          </div>

          {/* 4. 무설치 자동 업데이트 (OTA) */}
          <div className="rounded-xl border bg-card p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="space-y-0.5">
                <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <RefreshCw className="h-3.5 w-3.5 text-primary" />
                  <span>무설치 자동 업데이트 (OTA)</span>
                </h4>
                <p className="text-[11px] text-muted-foreground">
                  화면 업데이트는 설치 파일 없이 받아 둡니다. 프로그램을 완전히 종료한 뒤 다시 열면 적용됩니다.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2 pt-1 border-t">
              <span className="text-[11px] text-muted-foreground">
                현재 버전:{" "}
                <strong className="text-foreground font-mono">
                  v{versionInfo.bundleVersion}
                </strong>{" "}
                (런처 v{versionInfo.appVersion})
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={checkingOta}
                onClick={() => void handleManualOtaCheck()}
                className="h-7 text-xs gap-1.5"
              >
                <RefreshCw
                  className={`h-3 w-3 ${checkingOta ? "animate-spin" : ""}`}
                />
                <span>{checkingOta ? "확인 중..." : "최신 업데이트 확인"}</span>
              </Button>
            </div>
          </div>

          <div className="rounded-lg bg-muted/40 px-3 py-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              <span>클립보드 캡처 붙여넣기(`Ctrl+V`) 및 대화방 더블클릭 새 창 열기 지원</span>
            </span>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
