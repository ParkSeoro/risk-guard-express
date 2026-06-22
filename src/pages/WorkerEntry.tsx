import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { HardHat, QrCode, Phone, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * 근로자 자동 로그인 진입점 (옵션 B: QR-only)
 * - 저장된 토큰이 있으면 곧장 포털로 이동 → "앱이 항상 켜져 있는" 체감
 * - 없으면 안내. (향후 옵션 A: SMS OTP 활성화 시 폰번호 입력 → request_worker_otp RPC 호출)
 * PWA `start_url`로 사용 권장: /worker
 */
const SMS_ENABLED = false; // 추후 true 로 바꾸면 OTP 흐름 활성화

export default function WorkerEntry() {
  const navigate = useNavigate();
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("workerToken");
    if (token) {
      navigate(`/worker/portal/${token}`, { replace: true });
    }
  }, [navigate]);

  const requestOtp = async () => {
    if (!SMS_ENABLED) {
      toast.info("SMS 인증은 곧 제공됩니다. 현재는 QR 등록만 가능합니다.");
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc("request_worker_otp" as any, { _phone: phone.trim() });
    setLoading(false);
    if (error || (data as any)?.error) { toast.error("발송 실패"); return; }
    setStep("otp");
    toast.success("인증번호를 발송했습니다");
  };

  const verifyOtp = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("verify_worker_otp" as any, { _phone: phone.trim(), _code: otp.trim() });
    setLoading(false);
    if (error || (data as any)?.error || !(data as any)?.qr_token) {
      toast.error("인증 실패");
      return;
    }
    const token = (data as any).qr_token as string;
    localStorage.setItem("workerToken", token);
    navigate(`/worker/portal/${token}`, { replace: true });
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
              <HardHat className="h-6 w-6 text-primary-foreground" />
            </div>
            <CardTitle>근로자 로그인</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-3 rounded text-sm space-y-1">
            <div className="flex items-center gap-2 font-semibold"><QrCode className="h-4 w-4" /> 처음이신가요?</div>
            <div className="text-muted-foreground">현장 게시판의 <strong>근로자 등록 QR</strong>을 스캔하여 등록을 마치면, 이 기기에서 자동으로 로그인됩니다.</div>
          </div>

          {SMS_ENABLED ? (
            step === "phone" ? (
              <>
                <div>
                  <Label className="text-base">전화번호로 다시 로그인</Label>
                  <Input className="h-12 text-lg" value={phone} onChange={e => setPhone(e.target.value)} placeholder="010-1234-5678" inputMode="tel" />
                </div>
                <Button className="w-full h-14 text-lg" onClick={requestOtp} disabled={loading || phone.trim().length < 8}>
                  {loading && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}<Phone className="h-5 w-5 mr-2" />인증번호 받기
                </Button>
              </>
            ) : (
              <>
                <div>
                  <Label className="text-base">인증번호 6자리</Label>
                  <Input className="h-12 text-lg tracking-widest text-center" value={otp} onChange={e => setOtp(e.target.value)} placeholder="123456" inputMode="numeric" maxLength={6} />
                </div>
                <Button className="w-full h-14 text-lg" onClick={verifyOtp} disabled={loading || otp.length !== 6}>
                  {loading && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}확인 후 로그인
                </Button>
              </>
            )
          ) : (
            <div className="text-xs text-center text-muted-foreground pt-2">
              ※ 전화번호 인증 로그인은 추후 추가 예정입니다.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
