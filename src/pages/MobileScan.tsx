import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, ScanLine, ExternalLink, Loader2 } from "lucide-react";
import { Html5Qrcode } from "html5-qrcode";
import { toast } from "sonner";

// 모바일 QR 스캔 — 카메라로 근로자 QR 토큰 인식 → 출입 포털로 이동
export default function MobileScan() {
  const navigate = useNavigate();
  const containerId = "qr-reader";
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const [scanning, setScanning] = useState(false);
  const [last, setLast] = useState<{ token: string; url: string } | null>(null);
  const [error, setError] = useState("");

  const start = async () => {
    setError(""); setLast(null);
    // 1) 보안 컨텍스트 / API 가용성 점검
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setError("HTTPS 환경에서만 카메라를 사용할 수 있습니다. 배포 도메인(예: safenex.org)에서 다시 시도하세요.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("이 브라우저는 카메라 API를 지원하지 않습니다. Chrome/Safari 최신 버전을 사용하세요.");
      return;
    }
    // 2) 사용자 제스처 컨텍스트에서 직접 권한 요청 (iOS Safari/iframe 호환)
    let probeStream: MediaStream | null = null;
    try {
      probeStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
    } catch (e: any) {
      const name = e?.name || "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError("카메라 권한이 거부되었습니다. 브라우저 주소창의 자물쇠 아이콘 → 카메라 허용 후 다시 시도하세요.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setError("후면 카메라를 찾을 수 없습니다. 다른 카메라로 다시 시도합니다.");
        try {
          probeStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          setError("");
        } catch (e2: any) {
          setError("카메라 시작 실패: " + (e2?.message || e2?.name || "알 수 없는 오류"));
          return;
        }
      } else if (name === "NotReadableError") {
        setError("다른 앱이 카메라를 사용 중입니다. 해당 앱을 종료 후 다시 시도하세요.");
        return;
      } else {
        setError("카메라 시작 실패: " + (e?.message || name || "알 수 없는 오류"));
        return;
      }
    }
    // 권한 확인용 스트림은 즉시 정지 (Html5Qrcode가 자체 스트림 시작)
    try { probeStream?.getTracks().forEach(t => t.stop()); } catch {}

    // 3) QR 스캐너 시작
    try {
      const scanner = new Html5Qrcode(containerId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: { ideal: "environment" } as any },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => onDetect(decoded),
        () => {}
      );
      setScanning(true);
    } catch (e: any) {
      setError("스캐너 초기화 실패: " + (e?.message || e?.name || "오류"));
    }
  };

  const stop = async () => {
    try { await scannerRef.current?.stop(); await scannerRef.current?.clear(); } catch {}
    scannerRef.current = null;
    setScanning(false);
  };

  useEffect(() => () => { stop(); }, []);

  const onDetect = async (text: string) => {
    // 지원 포맷: 풀URL 또는 단순 토큰
    let token = text.trim();
    const m = token.match(/\/worker\/portal\/([A-Za-z0-9]+)/);
    if (m) token = m[1];
    if (!/^[A-Za-z0-9]{16,}$/.test(token)) {
      setError("인식된 QR이 근로자 토큰 형식이 아닙니다: " + text.slice(0, 60));
      return;
    }
    const url = `${window.location.origin}/worker/portal/${token}`;
    setLast({ token, url });
    await stop();
    toast.success("QR 인식 완료 — 포털로 이동");
  };

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button size="icon" variant="ghost" className="text-primary-foreground" onClick={() => navigate("/m")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <ScanLine className="h-5 w-5" />
        <div className="font-bold text-lg">근로자 QR 스캔</div>
      </header>

      <main className="p-4 space-y-3 max-w-md mx-auto">
        <Card>
          <CardContent className="pt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              근로자 QR을 카메라로 비추면 자동 인식되어 출입(입/퇴장) 포털로 이동합니다.
            </p>

            <div id={containerId}
              className="w-full aspect-square bg-black rounded-lg overflow-hidden flex items-center justify-center text-muted text-sm">
              {!scanning && !last && <span>스캔 준비</span>}
            </div>

            {!scanning && !last && (
              <Button className="w-full h-14 text-base" onClick={start}>
                <ScanLine className="h-5 w-5 mr-2" /> 스캔 시작
              </Button>
            )}
            {scanning && (
              <Button variant="outline" className="w-full h-12" onClick={stop}>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" /> 인식 중… (중지)
              </Button>
            )}

            {error && <Badge variant="destructive" className="w-full justify-center">{error}</Badge>}

            {last && (
              <div className="space-y-2 border-t pt-3">
                <div className="text-xs text-muted-foreground break-all">토큰: {last.token}</div>
                <Button className="w-full h-14 text-base" onClick={() => window.location.href = last.url}>
                  <ExternalLink className="h-5 w-5 mr-2" /> 포털 열기 (입퇴장)
                </Button>
                <Button variant="outline" className="w-full" onClick={() => { setLast(null); start(); }}>
                  다시 스캔
                </Button>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              * HTTPS 환경에서 카메라가 작동합니다. 권한 거부 시 브라우저 설정에서 카메라를 허용해주세요.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
