/**
 * 더보기 · 앱 버전: Play/AAB (네이티브) vs 화면 OTA.
 * Auto-update runs on boot/resume (see initOtaUpdater) — this card is for visibility / retry.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, RefreshCw, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { checkAndDownloadOta, getOtaStatus, type OtaStatus } from "@/lib/native/otaUpdater";
import { isNativeApp } from "@/lib/native/isNativeApp";
import { nativePlatform } from "@/lib/native/platform";
import { openPlayStore } from "@/lib/playStore";
import {
  fetchNativeStoreUpdateState,
  formatNativeVersionLabel,
  getNativeIdentity,
  type NativeIdentity,
  type NativeStoreUpdateState,
} from "@/lib/native/nativeStoreUpdate";

export default function MobileOtaUpdateCard() {
  const [status, setStatus] = useState<OtaStatus | null>(null);
  const [native, setNative] = useState<NativeIdentity | null>(null);
  const [store, setStore] = useState<NativeStoreUpdateState | null>(null);
  const [busy, setBusy] = useState(false);
  const platform = nativePlatform();

  const refresh = useCallback(async () => {
    const [s, id, storeState] = await Promise.all([
      getOtaStatus(),
      getNativeIdentity(),
      fetchNativeStoreUpdateState(),
    ]);
    setStatus(s);
    setNative(id);
    setStore(storeState);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCheck = async () => {
    setBusy(true);
    try {
      const r = await checkAndDownloadOta({ preferImmediate: true });
      await refresh();
      if (!r.ok) {
        toast.error(r.message);
        return;
      }
      if (r.apply === "immediate") {
        toast.success(r.message);
        return;
      }
      if (r.apply === "none") {
        return;
      }
      toast.success(r.message);
    } finally {
      setBusy(false);
    }
  };

  const nativeLabel = isNativeApp()
    ? formatNativeVersionLabel(native || store?.current)
    : null;

  return (
    <Card data-testid="mobile-app-version">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Smartphone className="h-4 w-4 text-muted-foreground" />
          앱 버전
        </div>
        <div className="space-y-1.5 text-[12px]">
          <div className="flex items-start justify-between gap-2">
            <span className="text-muted-foreground shrink-0">스토어 앱 (AAB)</span>
            <span className="text-right font-medium" data-testid="app-native-version">
              {isNativeApp()
                ? nativeLabel || "확인 중…"
                : "웹 · Play 설치본 아님"}
            </span>
          </div>
          <div className="flex items-start justify-between gap-2">
            <span className="text-muted-foreground shrink-0">화면 (OTA)</span>
            <span className="text-right font-medium" data-testid="app-ota-version">
              {status?.currentVersion || "확인 중…"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-[11px]">
          {platform !== "web" && (
            <Badge variant="secondary">{platform === "ios" ? "iOS" : "Android"}</Badge>
          )}
          {store?.needed ? (
            <Badge variant="destructive">Play 스토어 업데이트 필요</Badge>
          ) : isNativeApp() && store?.applicable && !store.needed ? (
            <Badge variant="outline">스토어 앱 최신</Badge>
          ) : null}
          {status?.hasUpdate ? (
            <Badge>화면 업데이트 있음</Badge>
          ) : status && !status.hasUpdate ? (
            <Badge variant="secondary">화면 최신</Badge>
          ) : null}
          {status && <Badge variant="outline">{status.channel}</Badge>}
        </div>
        {store?.needed && store.minNative && (
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            필요 네이티브 {store.minNative}. OTA만으로는 GPS·알람 플러그인이 안 바뀝니다.
          </p>
        )}
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {isNativeApp()
            ? "스토어 앱 번호가 Play에 올린 AAB입니다. 화면 번호는 자동 OTA입니다."
            : "브라우저/미리보기입니다. 스토어 앱 버전은 폰에서 더보기로 확인하세요."}
        </p>
        {store?.needed && platform === "android" && (
          <Button type="button" size="sm" className="w-full h-9" onClick={() => openPlayStore()}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Play 스토어에서 앱 업데이트
          </Button>
        )}
        {isNativeApp() && status?.hasUpdate && (
          <Button
            type="button"
            size="sm"
            className="w-full h-9"
            disabled={busy}
            onClick={() => void onCheck()}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${busy ? "animate-spin" : ""}`} />
            {busy ? "적용 중…" : "화면 업데이트 지금 적용"}
          </Button>
        )}
        {isNativeApp() && !status?.hasUpdate && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="w-full h-9"
            disabled={busy}
            onClick={() => void onCheck()}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${busy ? "animate-spin" : ""}`} />
            {busy ? "확인 중…" : "다시 확인"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
