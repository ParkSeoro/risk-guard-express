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
    try {
      const scanner = new Html5Qrcode(containerId);
      scannerRef.current = scanner;
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 240, height: 240 } },
        (decoded) => onDetect(decoded),
        () => {}
      );
      setScanning(true);
    } catch (e: any) {
      setError(e?.message || "카메라 시작 실패");
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
