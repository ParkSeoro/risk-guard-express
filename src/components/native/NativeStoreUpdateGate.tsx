/**
 * When the installed AAB is older than app_releases.min_native_version,
 * send Android users to Play Store (OTA cannot ship native plugins).
 */
import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import { openPlayStore } from "@/lib/playStore";
import {
  fetchNativeStoreUpdateState,
  isStoreUpdateSnoozed,
  snoozeStoreUpdateToday,
  type NativeStoreUpdateState,
} from "@/lib/native/nativeStoreUpdate";

export default function NativeStoreUpdateGate() {
  const [state, setState] = useState<NativeStoreUpdateState | null>(null);
  const [open, setOpen] = useState(false);

  const refresh = useCallback(async () => {
    const s = await fetchNativeStoreUpdateState();
    setState(s);
    setOpen(s.needed && !isStoreUpdateSnoozed());
  }, []);

  useEffect(() => {
    void refresh();
    const onVis = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [refresh]);

  if (!state?.needed) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) return; setOpen(v); }}>
      <DialogContent
        className="max-w-sm"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        data-testid="native-store-update-gate"
      >
        <DialogHeader>
          <DialogTitle>앱 업데이트가 필요합니다</DialogTitle>
          <DialogDescription className="text-left space-y-2">
            <span className="block">
              위치 추적·위험구역 알람처럼 스토어에 올리는 앱(AAB)이 바뀌었습니다.
              화면 OTA만으로는 적용되지 않습니다.
            </span>
            <span className="block text-xs">
              설치됨 {state.current?.version} ({state.current?.build})
              {state.minNative ? ` · 필요 ${state.minNative}` : ""}
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col sm:flex-col gap-2">
          <Button className="w-full" onClick={() => openPlayStore()}>
            <Download className="h-4 w-4 mr-1.5" />
            Play 스토어에서 업데이트
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              snoozeStoreUpdateToday();
              setOpen(false);
            }}
          >
            나중에 (오늘만)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
