/**
 * OTA status + optional manual check.
 * Auto-update runs on boot/resume (see initOtaUpdater) — this card is for visibility / retry.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { checkAndDownloadOta, getOtaStatus, type OtaStatus } from "@/lib/native/otaUpdater";
import { isNativeApp } from "@/lib/native/isNativeApp";

export default function MobileOtaUpdateCard() {
  const [status, setStatus] = useState<OtaStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const s = await getOtaStatus();
    setStatus(s);
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
        // Soft: do not cover UI for "already latest" — badge text is enough.
        return;
      }
      toast.success(r.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Smartphone className="h-4 w-4 text-muted-foreground" />
          앱 화면 업데이트 (OTA)
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          앱을 열거나 다시 돌아올 때 <b>자동으로</b> 새 화면을 받아 적용합니다.
          스토어 재설치는 필요 없습니다.
          {!isNativeApp() && " (지금 화면은 웹/미리보기라 OTA 대상이 아닙니다.)"}
        </p>
        {status && (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <Badge variant="outline">현재 {status.currentVersion}</Badge>
            {status.latestVersion && (
              <Badge variant={status.hasUpdate ? "default" : "secondary"}>
                서버 {status.latestVersion}
              </Badge>
            )}
            <Badge variant="secondary">{status.channel}</Badge>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          {status?.message || "확인 중…"}
        </p>
        {isNativeApp() && status?.hasUpdate && (
          <Button
            type="button"
            size="sm"
            className="w-full h-9"
            disabled={busy}
            onClick={() => void onCheck()}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${busy ? "animate-spin" : ""}`} />
            {busy ? "적용 중…" : "지금 바로 적용"}
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
