import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isNativeApp } from "@/lib/native/isNativeApp";
import {
  checkInBlockedByLocation,
  isForegroundLocationGranted,
  locationPermissionTriState,
  locationTapStepsKo,
  shouldShowGpsConsentCoach,
} from "@/lib/native/nativePermissionGate";
import { promptBackgroundLocation } from "@/lib/native/promptBackgroundLocation";
import { openNativeAppSettings } from "@/lib/native/openNativeAppSettings";
import { todaySnoozeStamp } from "@/lib/native/nativeStoreUpdate";
import { toast } from "sonner";

const DISMISS_KEY = "safenex.gpsAlwaysCoach.date";

function alwaysAllowDismissedToday(now = todaySnoozeStamp()): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === now;
  } catch {
    return false;
  }
}

function dismissAlwaysAllowCoachToday(): void {
  try {
    localStorage.setItem(DISMISS_KEY, todaySnoozeStamp());
  } catch {
    /* ignore */
  }
}

function platformForGuide(): "android" | "ios" | "web" {
  if (!isNativeApp()) return "web";
  return Capacitor.getPlatform() === "ios" ? "ios" : "android";
}

export default function GpsConsentCoach({
  isCheckedIn,
  hasFix,
  onOsLocationChange,
}: {
  isCheckedIn: boolean;
  hasFix: boolean;
  onOsLocationChange?: (granted: boolean | null) => void;
}) {
  const [osGranted, setOsGranted] = useState<boolean | null>(isNativeApp() ? null : true);
  const [dismissed, setDismissed] = useState(alwaysAllowDismissedToday);
  const [busy, setBusy] = useState(false);

  const refreshOs = async () => {
    if (!isNativeApp()) {
      setOsGranted(true);
      onOsLocationChange?.(true);
      return;
    }
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      const cur = await Geolocation.checkPermissions();
      const granted = locationPermissionTriState(cur);
      setOsGranted(granted);
      onOsLocationChange?.(granted);
    } catch {
      setOsGranted(null);
      onOsLocationChange?.(null);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await refreshOs();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onOsLocationChange]);

  const requestOsLocation = async () => {
    if (!isNativeApp()) return;
    setBusy(true);
    try {
      const { Geolocation } = await import("@capacitor/geolocation");
      const cur = await Geolocation.checkPermissions();
      if (!isForegroundLocationGranted(cur)) {
        await Geolocation.requestPermissions();
      }
      await promptBackgroundLocation();
      await refreshOs();
      const after = await Geolocation.checkPermissions();
      if (!isForegroundLocationGranted(after)) {
        toast.message("허용이 안 되면 아래 「앱 설정 열기」에서 위치를 켜 주세요.");
      }
    } catch (e: any) {
      toast.error("위치 권한 요청 실패: " + (e?.message || "오류"));
    } finally {
      setBusy(false);
    }
  };

  const denied = osGranted === false;
  const visible = shouldShowGpsConsentCoach({
    osLocationGranted: osGranted,
    isCheckedIn,
    alwaysAllowDismissedToday: dismissed,
  });
  if (!visible) return null;

  const platform = platformForGuide();
  const isIos = platform === "ios";
  const steps = locationTapStepsKo(platform);
  const gate = checkInBlockedByLocation({ osLocationGranted: osGranted, hasFix });

  return (
    <section
      className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-3 shadow-sm"
      data-testid="gps-consent-coach"
    >
      <div className="flex items-start gap-2">
        <MapPin className="h-5 w-5 text-amber-800 shrink-0 mt-0.5" />
        <div>
          <div className="text-sm font-bold text-amber-950">
            {denied
              ? isIos
                ? "위치 권한이 꺼져 있어 출근 확인이 제한됩니다"
                : "위치 권한이 없어 출근·분포가 안 됩니다"
              : isIos
                ? "현장 위치 업데이트 안내"
                : "분포 점이 멈추면 「항상 허용」을 누르세요"}
          </div>
          <p className="text-xs text-amber-900/80 mt-1 leading-relaxed">
            {denied
              ? isIos
                ? "현장 출근 확인과 위험구역 안전 알림을 사용하려면 기기 설정에서 위치 권한을 변경할 수 있습니다."
                : "아래 항목을 그대로 눌러 주세요. 「거부」나 「앱 사용 중에만」이면 출근 GPS만 찍히고 점이 안 움직입니다."
              : isIos
                ? "화면이 꺼진 상태에서는 위치 업데이트가 일시 중지될 수 있습니다."
                : "출근 때 한 번 허용해도, 「앱 사용 중에만」이면 화면을 끈 뒤 점이 아침 위치에 남습니다."}
          </p>
        </div>
      </div>
      <ul className="text-xs text-amber-950 space-y-1.5 pl-1">
        {steps.map((line) => (
          <li key={line}>· {line}</li>
        ))}
      </ul>
      {gate.reason === "os" && !isCheckedIn && (
        <p className="text-xs font-semibold text-destructive">
          {isIos
            ? "위치 권한이 꺼져 있어 현장 출근 확인을 진행할 수 없습니다."
            : "위치를 허용하기 전에는 출근할 수 없습니다."}
        </p>
      )}
      <div className="flex flex-col gap-2">
        <Button className="w-full h-11" disabled={busy} onClick={() => void requestOsLocation()}>
          {isIos ? "계속" : "위치 허용 (시스템 팝업)"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full h-11"
          disabled={busy}
          onClick={() => void openNativeAppSettings()}
        >
          앱 설정 열기
        </Button>
        {!denied && isCheckedIn && (
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              dismissAlwaysAllowCoachToday();
              setDismissed(true);
            }}
          >
            {isIos ? "확인" : "항상 허용으로 바꿨습니다"}
          </Button>
        )}
      </div>
    </section>
  );
}
