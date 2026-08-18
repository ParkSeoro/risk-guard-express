/**
 * First-run OS permission onboarding for the native shell.
 * Legal consent (/consent) must already be complete — this screen only
 * requests Location → Notifications → Camera, once, via explicit CTA.
 */
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import { PushNotifications } from "@capacitor/push-notifications";
import { BarcodeScanner } from "@capacitor-mlkit/barcode-scanning";
import { useAuth } from "@/contexts/AuthContext";
import {
  postConsentHomePath,
  readLoginIntent,
} from "@/components/AuthGuard";
import {
  hasCompletedNativePermissions,
  isNativeApp,
  markNativePermissionsDone,
} from "@/lib/native/isNativeApp";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Bell, Camera, CheckCircle2, MapPin, Shield } from "lucide-react";
import { toast } from "sonner";
import { readActiveProjectId, writeActiveProjectId } from "@/lib/activeProject";

type Step = "location" | "notifications" | "camera" | "done";

async function ensureSelectedProject(userId: string, isMaster: boolean) {
  try {
    const cur = readActiveProjectId();
    if (cur) return cur;
    let list: { id: string; name?: string }[] = [];
    if (isMaster) {
      const { data } = await supabase
        .from("projects")
        .select("id, name")
        .eq("is_deleted", false)
        .order("created_at", { ascending: false })
        .limit(20);
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
    if (list.length >= 1) {
      writeActiveProjectId(list[0].id);
      return list[0].id;
    }
  } catch (e) {
    console.warn("[NativePermissions] project auto-select failed", e);
  }
  return null;
}

export default function NativePermissionsOnboarding() {
  const { user, roles, isAuthLoading } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("location");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user || !isNativeApp()) return;
    const isMaster = roles.some((r) => r.toLowerCase() === "master");
    void ensureSelectedProject(user.id, isMaster);
  }, [user, roles]);

  if (isAuthLoading) {
    return (
      <div className="min-h-dvh flex items-center justify-center text-sm text-muted-foreground native-safe-pad">
        세션 확인 중…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!isNativeApp() || hasCompletedNativePermissions()) {
    return (
      <Navigate
        to={postConsentHomePath(roles, { loginIntent: readLoginIntent() })}
        replace
      />
    );
  }

  const finish = () => {
    markNativePermissionsDone();
    navigate(postConsentHomePath(roles, { loginIntent: readLoginIntent() }), {
      replace: true,
    });
  };

  const requestLocation = async () => {
    setBusy(true);
    try {
      const cur = await Geolocation.checkPermissions();
      if (cur.location !== "granted" && cur.coarseLocation !== "granted") {
        await Geolocation.requestPermissions();
      }
      // Android 10+: request "Always" via BackgroundGeolocation once (Play BG-location).
      if (Capacitor.getPlatform() === "android") {
        try {
          const { registerPlugin } = await import("@capacitor/core");
          const BackgroundGeolocation = registerPlugin<any>("BackgroundGeolocation");
          if (BackgroundGeolocation?.addWatcher) {
            const id = await BackgroundGeolocation.addWatcher(
              {
                backgroundMessage: "위험구역 자동감지를 위해 위치를 추적합니다.",
                backgroundTitle: "SafeNex 위치",
                requestPermissions: true,
                stale: true,
                distanceFilter: 50,
              },
              () => {},
            );
            try {
              await BackgroundGeolocation.removeWatcher({ id });
            } catch {
              /* ignore */
            }
          }
        } catch (e) {
          console.warn("[NativePermissions] background location prompt skipped", e);
        }
      }
      setStep("notifications");
    } catch (e: any) {
      toast.error("위치 권한 요청 실패: " + (e?.message || "오류"));
      setStep("notifications");
    } finally {
      setBusy(false);
    }
  };

  const requestNotifications = async () => {
    setBusy(true);
    try {
      if (Capacitor.isNativePlatform()) {
        const perm = await PushNotifications.checkPermissions();
        if (perm.receive === "prompt" || perm.receive === "prompt-with-rationale") {
          await PushNotifications.requestPermissions();
        }
        const after = await PushNotifications.checkPermissions();
        if (after.receive === "granted") {
          await PushNotifications.register();
        }
      }
      setStep("camera");
    } catch (e: any) {
      toast.error("알림 권한 요청 실패: " + (e?.message || "오류"));
      setStep("camera");
    } finally {
      setBusy(false);
    }
  };

  const requestCamera = async () => {
    setBusy(true);
    try {
      await BarcodeScanner.requestPermissions();
      setStep("done");
    } catch (e: any) {
      toast.message("카메라는 나중에 QR 스캔 시 다시 요청할 수 있습니다.");
      setStep("done");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh bg-background flex flex-col native-safe-pad">
      <header className="px-5 pt-4 pb-2">
        <div className="flex items-center gap-2 text-primary">
          <Shield className="h-5 w-5" />
          <span className="font-bold text-lg">SafeNex</span>
        </div>
        <h1 className="mt-3 text-xl font-bold tracking-tight">앱 권한 설정</h1>
        <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
          현장 안전(금지구역·결재 알림·QR)을 위해 권한이 필요합니다. 한 번에 순서대로 허용해 주세요.
        </p>
      </header>

      <main className="flex-1 px-5 py-4 space-y-3">
        <StepCard
          active={step === "location"}
          done={step !== "location"}
          icon={MapPin}
          title="위치"
          desc="금지구역 자동 감지·출입 확인. 가능하면 「항상 허용」을 선택하세요."
        />
        <StepCard
          active={step === "notifications"}
          done={step === "camera" || step === "done"}
          icon={Bell}
          title="알림"
          desc="결재 요청·금지구역 경보 푸시"
        />
        <StepCard
          active={step === "camera"}
          done={step === "done"}
          icon={Camera}
          title="카메라"
          desc="근로자 QR 스캔·점검 사진 (선택)"
        />
      </main>

      <footer className="px-5 pb-6 space-y-2">
        {step === "location" && (
          <Button className="w-full h-12 text-base" disabled={busy} onClick={() => void requestLocation()}>
            위치 허용
          </Button>
        )}
        {step === "notifications" && (
          <Button className="w-full h-12 text-base" disabled={busy} onClick={() => void requestNotifications()}>
            알림 허용
          </Button>
        )}
        {step === "camera" && (
          <>
            <Button className="w-full h-12 text-base" disabled={busy} onClick={() => void requestCamera()}>
              카메라 허용
            </Button>
            <Button variant="ghost" className="w-full" disabled={busy} onClick={() => setStep("done")}>
              나중에
            </Button>
          </>
        )}
        {step === "done" && (
          <Button className="w-full h-12 text-base gap-2" onClick={finish}>
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
        className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
          done ? "bg-emerald-600 text-white" : active ? "bg-primary text-primary-foreground" : "bg-muted"
        }`}
      >
        {done ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{desc}</p>
      </div>
    </div>
  );
}
