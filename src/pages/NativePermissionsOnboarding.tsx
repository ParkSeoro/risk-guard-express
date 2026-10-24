/**
 * First-run OS permission onboarding for the native shell.
 * Legal consent (/consent) must already be complete.
 * Location → Notifications. Android then shows the system battery Allow dialog.
 * Camera is requested later, when a QR scan or photo is taken.
 * Location is a hard gate. The battery step can be skipped with 나중에.
 */
import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Geolocation } from "@capacitor/geolocation";
import { PushNotifications } from "@capacitor/push-notifications";
import { useAuth } from "@/contexts/AuthContext";
import {
  afterConsentHomePath,
  readLoginIntent,
} from "@/components/AuthGuard";
import {
  hasCompletedNativePermissions,
  isNativeApp,
  markNativePermissionsDone,
} from "@/lib/native/isNativeApp";
import {
  ANDROID_LOCATION_TAP_STEPS_KO,
  BATTERY_ALLOW_DIALOG_KO,
  canMarkNativePermissionsDone,
  IOS_LOCATION_TAP_STEPS_KO,
  isForegroundLocationGranted,
  isPushGranted,
} from "@/lib/native/nativePermissionGate";
import {
  batteryOptimizationStatus,
  requestBatteryUnrestricted,
} from "@/lib/native/batteryOptimization";
import { promptBackgroundLocation } from "@/lib/native/promptBackgroundLocation";
import { openNativeAppSettings } from "@/lib/native/openNativeAppSettings";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Battery, Bell, CheckCircle2, MapPin, Shield } from "lucide-react";
import { toast } from "sonner";
import { pickSessionProjectId, readActiveProjectId, writeActiveProjectId } from "@/lib/activeProject";

type Step = "location" | "notifications" | "battery" | "done";

function nextAfterNotifications(): Step {
  return Capacitor.getPlatform() === "android" ? "battery" : "done";
}

async function ensureSelectedProject(userId: string, isMaster: boolean) {
  try {
    const { data: prof } = await supabase
      .from("profiles")
      .select("default_project_id")
      .eq("user_id", userId)
      .maybeSingle();
    const preferred = String((prof as { default_project_id?: string | null } | null)?.default_project_id || "").trim();
    const cur = readActiveProjectId();
    let list: { id: string; name?: string }[] = [];
    if (isMaster) {
      const { data } = await supabase
        .from("projects")
        .select("id, name")
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });
      list = data || [];
    } else {
      const { data } = await supabase
        .from("project_members")
        .select("projects(id, name, is_deleted)")
        .eq("user_id", userId);
      list = (data || [])
        .map((m: any) => m.projects)
        .filter((p: any) => p && !p.is_deleted);
    }
    const allowed = list.map((p) => p.id);
    const picked = pickSessionProjectId({
      allowedIds: allowed,
      defaultProjectId: preferred,
      storedId: cur,
    });
    if (picked) {
      writeActiveProjectId(picked);
      return picked;
    }
  } catch (e) {
    console.warn("[NativePermissions] project auto-select failed", e);
  }
  return null;
}

export default function NativePermissionsOnboarding() {
  const { user, roles, isAuthLoading, profile } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("location");
  const [busy, setBusy] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [pushDenied, setPushDenied] = useState(false);
  const [batteryUnavailable, setBatteryUnavailable] = useState(false);
  const isAndroid = Capacitor.getPlatform() === "android";

  useEffect(() => {
    if (!user || !isNativeApp()) return;
    const isMaster = roles.some((r) => r.toLowerCase() === "master");
    void ensureSelectedProject(user.id, isMaster);
  }, [user, roles]);

  useEffect(() => {
    if (!isNativeApp()) return;
    let handle: { remove: () => Promise<void> } | undefined;
    void App.addListener("appStateChange", ({ isActive }) => {
      if (!isActive) return;
      void (async () => {
        if (step === "location") {
          const cur = await Geolocation.checkPermissions();
          if (isForegroundLocationGranted(cur)) {
            setLocationDenied(false);
          }
        }
        if (step === "notifications") {
          const cur = await PushNotifications.checkPermissions();
          if (isPushGranted(cur)) setPushDenied(false);
        }
        if (step === "battery") {
          const status = await batteryOptimizationStatus();
          if (status === "ignoring") setStep("done");
        }
      })();
    }).then((h) => {
      handle = h;
    });
    return () => {
      void handle?.remove();
    };
  }, [step]);

  const finish = useCallback(async () => {
    setBusy(true);
    try {
      const cur = await Geolocation.checkPermissions();
      if (!canMarkNativePermissionsDone({ locationGranted: isForegroundLocationGranted(cur) })) {
        toast.error("위치 권한이 있어야 출근·금지구역이 동작합니다.");
        setLocationDenied(true);
        setStep("location");
        return;
      }
      markNativePermissionsDone();
      navigate(afterConsentHomePath(roles, profile, { loginIntent: readLoginIntent() }), {
        replace: true,
      });
    } finally {
      setBusy(false);
    }
  }, [navigate, roles, profile]);

  const requestLocation = useCallback(async () => {
    setBusy(true);
    try {
      const cur = await Geolocation.checkPermissions();
      if (!isForegroundLocationGranted(cur)) {
        await Geolocation.requestPermissions();
      }
      const after = await Geolocation.checkPermissions();
      if (!isForegroundLocationGranted(after)) {
        setLocationDenied(true);
        toast.error("「정확한 위치」와 「항상 허용」을 눌러야 출근·분포가 됩니다.");
        return;
      }
      setLocationDenied(false);
      await promptBackgroundLocation();
      setStep("notifications");
    } catch (e: any) {
      setLocationDenied(true);
      toast.error("위치 권한 요청 실패: " + (e?.message || "오류"));
    } finally {
      setBusy(false);
    }
  }, []);

  const requestNotifications = useCallback(async () => {
    setBusy(true);
    try {
      if (Capacitor.isNativePlatform()) {
        const perm = await PushNotifications.checkPermissions();
        if (!isPushGranted(perm)) {
          await PushNotifications.requestPermissions();
        }
        const after = await PushNotifications.checkPermissions();
        if (!isPushGranted(after)) {
          setPushDenied(true);
          toast.error("알림을 허용해야 금지구역·결재 푸시를 받을 수 있습니다.");
          return;
        }
        setPushDenied(false);
        try {
          await PushNotifications.register();
        } catch (regErr) {
          console.warn("[NativePermissions] push register", regErr);
        }
      }
      setStep(nextAfterNotifications());
    } catch (e: any) {
      setPushDenied(true);
      toast.error("알림 권한 요청 실패: " + (e?.message || "오류"));
    } finally {
      setBusy(false);
    }
  }, []);

  const requestBattery = useCallback(async () => {
    setBusy(true);
    try {
      const result = await requestBatteryUnrestricted();
      if (result === "already") {
        setStep("done");
        return;
      }
      if (result === "unavailable") {
        setBatteryUnavailable(true);
        return;
      }
      setBatteryUnavailable(false);
    } finally {
      setBusy(false);
    }
  }, []);

  if (isAuthLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-base text-muted-foreground native-safe-pad">
        세션 확인 중…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!isNativeApp() || hasCompletedNativePermissions()) {
    return (
      <Navigate
        to={afterConsentHomePath(roles, profile, { loginIntent: readLoginIntent() })}
        replace
      />
    );
  }

  return (
    <div className="min-h-dvh bg-background flex flex-col native-safe-pad">
      <header className="px-5 pt-4 pb-2">
        <div className="flex items-center gap-2 text-primary">
          <Shield className="h-6 w-6" />
          <span className="font-bold text-xl">SafeNex</span>
        </div>
        <h1 className="mt-3 text-2xl font-bold tracking-tight">앱 권한 설정</h1>
        <p className="mt-2 text-base text-muted-foreground leading-relaxed">
          아래 버튼을 누르면 폰 허용 창이 뜹니다. 허용을 누르세요.
        </p>
      </header>

      <main className="flex-1 px-5 py-4 space-y-3">
        <StepCard
          active={step === "location"}
          done={step !== "location"}
          icon={MapPin}
          title="위치"
          desc="출근·분포·금지구역. 「항상 허용」을 누르세요."
        />
        <StepCard
          active={step === "notifications"}
          done={step === "battery" || step === "done"}
          icon={Bell}
          title="알림"
          desc="결재 푸시·금지구역 경보"
        />
        {isAndroid && (
          <StepCard
            active={step === "battery"}
            done={step === "done"}
            icon={Battery}
            title="배터리 제한 없음"
            desc="허용 창에서 한 번만 누르면 됩니다."
          />
        )}
      </main>

      <footer className="px-5 pb-6 space-y-2">
        {step === "location" && (
          <>
            <ul className="text-sm text-muted-foreground space-y-2 rounded-xl border bg-muted/40 p-4">
              {(isAndroid ? ANDROID_LOCATION_TAP_STEPS_KO : IOS_LOCATION_TAP_STEPS_KO).map((line) => (
                <li key={line}>· {line}</li>
              ))}
            </ul>
            {locationDenied && (
              <p className="text-sm text-destructive leading-relaxed">
                위치를 거부하면 출근할 수 없습니다. 허용 창에서 「항상 허용」을 눌러 주세요.
              </p>
            )}
            <Button className="w-full h-14 text-lg" disabled={busy} onClick={() => void requestLocation()}>
              위치 허용
            </Button>
            {locationDenied && (
              <Button variant="outline" className="w-full h-12 text-base" disabled={busy} onClick={() => void openNativeAppSettings()}>
                앱 설정 열기
              </Button>
            )}
          </>
        )}
        {step === "notifications" && (
          <>
            {pushDenied && (
              <p className="text-sm text-destructive leading-relaxed">
                알림을 끄면 앱을 닫았을 때 금지구역 사이렌·결재 푸시를 받지 못합니다.
              </p>
            )}
            <Button className="w-full h-14 text-lg" disabled={busy} onClick={() => void requestNotifications()}>
              알림 허용
            </Button>
            {pushDenied && (
              <Button
                variant="ghost"
                className="w-full h-12 text-base"
                disabled={busy}
                onClick={() => setStep(nextAfterNotifications())}
              >
                나중에
              </Button>
            )}
          </>
        )}
        {step === "battery" && (
          <>
            <p className="text-base leading-relaxed rounded-xl border bg-muted/40 p-4">
              {batteryUnavailable
                ? "이 폰의 앱에는 허용 창이 아직 없습니다. 나중에를 누르면 앱을 쓸 수 있습니다."
                : BATTERY_ALLOW_DIALOG_KO}
            </p>
            {!batteryUnavailable && (
              <Button className="w-full h-14 text-lg" disabled={busy} onClick={() => void requestBattery()}>
                허용
              </Button>
            )}
            <Button
              variant="ghost"
              className="w-full h-12 text-base"
              disabled={busy}
              onClick={() => setStep("done")}
            >
              나중에
            </Button>
          </>
        )}
        {step === "done" && (
          <Button className="w-full h-14 text-lg gap-2" disabled={busy} onClick={() => void finish()}>
            <CheckCircle2 className="h-5 w-5" />
            시작하기
          </Button>
        )}
      </footer>
    </div>
  );
}

function StepCard({
  active,
  done,
  icon: Icon,
  title,
  desc,
}: {
  active: boolean;
  done: boolean;
  icon: typeof MapPin;
  title: string;
  desc: string;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 flex gap-3 ${
        active ? "border-primary bg-primary/5" : done ? "border-emerald-200 bg-emerald-50/50" : "opacity-60"
      }`}
    >
      <div
        className={`h-12 w-12 rounded-xl flex items-center justify-center shrink-0 ${
          done ? "bg-emerald-600 text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        {done ? <CheckCircle2 className="h-6 w-6" /> : <Icon className="h-6 w-6" />}
      </div>
      <div>
        <div className="text-lg font-semibold">{title}</div>
        <p className="text-sm text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}
