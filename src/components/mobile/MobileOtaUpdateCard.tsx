/**
 * Shows current OTA bundle version + how to apply updates on the phone.
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
      const r = await checkAndDownloadOta();
      await refresh();
      if (r.ok) toast.success(r.message);
      else toast.error(r.message);
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
          OTA는 스토어 재설치 없이 <b>앱 안의 화면·기능만</b> 받는 방식입니다.
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
        <ol className="text-[11px] text-muted-foreground list-decimal pl-4 space-y-0.5 leading-relaxed">
          <li>아래 「업데이트 확인」을 누릅니다 (와이파이/데이터 켜기).</li>
          <li>다운로드되면 <b>최근 앱 목록에서 SafeNex를 위로 밀어 완전 종료</b>합니다.</li>
          <li>SafeNex를 다시 실행합니다. (한 번 더 종료→실행해도 됩니다)</li>
        </ol>
        <Button
          type="button"
          size="sm"
          className="w-full h-9"
          disabled={busy || !isNativeApp()}
          onClick={() => void onCheck()}
        >
          <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${busy ? "animate-spin" : ""}`} />
          {busy ? "확인 중…" : "업데이트 확인 · 다운로드"}
        </Button>
      </CardContent>
    </Card>
  );
}
