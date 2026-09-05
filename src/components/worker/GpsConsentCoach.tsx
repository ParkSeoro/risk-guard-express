import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isNativeApp } from "@/lib/native/isNativeApp";
import {
  checkInBlockedByLocation,
  isForegroundLocationGranted,
  locationTapStepsKo,
  shouldShowGpsConsentCoach,
} from "@/lib/native/nativePermissionGate";
import { openNativeAppSettings } from "@/lib/native/openNativeAppSettings";
import { todaySnoozeStamp } from "@/lib/native/nativeStoreUpdate";

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

  useEffect(() => {
    if (!isNativeApp()) {
      setOsGranted(true);
      onOsLocationChange?.(true);
      return;
    }
    let cancelled = false;
    const read = async () => {
      try {
        const cur = await Geolocation.checkPermissions();
        if (cancelled) return;
        const granted = isForegroundLocationGranted(cur);
        setOsGranted(granted);
        onOsLocationChange?.(granted);
      } catch {
        if (cancelled) return;
        setOsGranted(null);
        onOsLocationChange?.(null);
      }
    };
    void read();
    return () => {
      cancelled = true;
    };
  }, [onOsLocationChange]);

  const denied = osGranted === false;
  const visible = shouldShowGpsConsentCoach({
    osLocationGranted: osGranted,
    isCheckedIn,
    alwaysAllowDismissedToday: dismissed,
  });
  if (!visible) return null;

  const steps = locationTapStepsKo(platformForGuide());
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
            {denied ? "위치 권한이 없어 출근·분포가 안 됩니다" : "분포 점이 멈추면 「항상 허용」을 누르세요"}
          </div>
          <p className="text-xs text-amber-900/80 mt-1 leading-relaxed">
            {denied
              ? "아래 항목을 그대로 눌러 주세요. 「거부」나 「앱 사용 중에만」이면 출근 GPS만 찍히고 점이 안 움직입니다."
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
        <p className="text-xs font-semibold text-destructive">위치를 허용하기 전에는 출근할 수 없습니다.</p>
      )}
      <div className="flex flex-col gap-2">
        <Button className="w-full h-11" onClick={() => void openNativeAppSettings()}>
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
            항상 허용으로 바꿨습니다
          </Button>
        )}
      </div>
    </section>
  );
}
