/**
 * 더보기 · 앱 버전: 설치 앱 번호와 화면 번호만 보여 준다.
 * 화면 zip은 initOtaUpdater가 받는다. 이 카드에는 받기 버튼이 없다.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Smartphone } from "lucide-react";
import { getOtaStatus, type OtaStatus } from "@/lib/native/otaUpdater";
import { isNativeApp } from "@/lib/native/isNativeApp";
import {
  formatNativeVersionLabel,
  getNativeIdentity,
  type NativeIdentity,
} from "@/lib/native/nativeStoreUpdate";

export default function MobileOtaUpdateCard() {
  const [status, setStatus] = useState<OtaStatus | null>(null);
  const [native, setNative] = useState<NativeIdentity | null>(null);

  const refresh = useCallback(async () => {
    const [s, id] = await Promise.all([getOtaStatus(), getNativeIdentity()]);
    setStatus(s);
    setNative(id);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const nativeLabel = isNativeApp() ? formatNativeVersionLabel(native) : null;

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
              {isNativeApp() ? nativeLabel || "확인 중…" : "웹"}
            </span>
          </div>
          <div className="flex items-start justify-between gap-2">
            <span className="text-muted-foreground shrink-0">화면 (OTA)</span>
            <span className="text-right font-medium" data-testid="app-ota-version">
              {status?.currentVersion || "확인 중…"}
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
