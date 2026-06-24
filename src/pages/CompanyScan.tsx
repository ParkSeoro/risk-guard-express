import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import ResponsiveSignaturePad, { ResponsiveSignaturePadHandle } from "@/components/ResponsiveSignaturePad";
import { IMESafeInput } from "@/components/IMESafeInput";
import { Building2, LogIn, LogOut, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";

/**
 * 회사 게시판 QR 스캔 페이지 (/c/:token) — 익명 라우트.
 * 근로자가 본인 이름·연락처를 입력하고 서명하여 출근/퇴근을 기록한다.
 */
export default function CompanyScan() {
  const { token = "" } = useParams();
  const [ctx, setCtx] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [action, setAction] = useState<"entry" | "exit">("entry");
  const [raOk, setRaOk] = useState(false);
  const [eduOk, setEduOk] = useState(false);
  const [tbmOk, setTbmOk] = useState(false);
  const [noAcc, setNoAcc] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<null | { action: string; worker_name: string }>(null);
  const sigRef = useRef<ResponsiveSignaturePadHandle>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("get_company_qr_by_token", { _token: token });
      setLoading(false);
      if (error || !data) {
        toast.error("유효하지 않은 QR입니다.");
        return;
      }
      setCtx(data);
    })();
  }, [token]);

  const submit = async () => {
    if (!name.trim() || phone.trim().length < 8) {
      toast.error("이름과 연락처(8자 이상)를 입력하세요.");
      return;
    }
    if (sigRef.current?.isEmpty()) {
      toast.error("서명이 필요합니다.");
      return;
    }
    if (action === "entry" && !(raOk && eduOk && tbmOk)) {
      toast.error("위험성평가/교육/TBM 확인이 필요합니다.");
      return;
    }
    if (action === "exit" && !noAcc) {
      toast.error("무재해 확인이 필요합니다.");
      return;
    }
    const signature = sigRef.current?.toDataURL("image/png") || "";
    setSubmitting(true);
    const { data, error } = await supabase.rpc("company_qr_check_in", {
      _token: token,
      _name: name.trim(),
      _phone: phone.trim(),
      _action: action,
      _signature: signature,
      _ra_confirmed: raOk,
      _edu_confirmed: eduOk,
      _tbm_confirmed: tbmOk,
      _no_accident: noAcc,
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    const r = data as any;
    if (r?.error) {
      toast.error(r.message || r.error);
      return;
    }
    setDone({ action: r.action, worker_name: r.worker_name });
  };

  if (loading) {
    return <div className="p-6 text-center text-sm text-muted-foreground">불러오는 중...</div>;
  }

  if (!ctx || (ctx as any).expired) {
    return (
      <div className="max-w-md mx-auto p-6">
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <XCircle className="h-12 w-12 mx-auto text-destructive" />
            <div className="font-semibold">QR이 만료되었거나 유효하지 않습니다</div>
            <div className="text-sm text-muted-foreground">관리자에게 새 QR을 요청하세요.</div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (done) {
    return (
      <div className="max-w-md mx-auto p-6">
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <CheckCircle2 className="h-14 w-14 mx-auto text-primary" />
            <div className="text-lg font-bold">
              {done.worker_name}님 {done.action === "entry" ? "출근" : "퇴근"} 완료
            </div>
            <div className="text-sm text-muted-foreground">{(ctx as any).company_name}</div>
            <Button onClick={() => { setDone(null); setName(""); setPhone(""); sigRef.current?.clear(); }}>
              다른 근로자 기록
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            {(ctx as any).company_name}
          </CardTitle>
          <div className="text-xs text-muted-foreground">{(ctx as any).work_date} · 게시판 QR 출퇴근</div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant={action === "entry" ? "default" : "outline"}
              onClick={() => setAction("entry")}
            >
              <LogIn className="h-4 w-4 mr-2" />출근
            </Button>
            <Button
              variant={action === "exit" ? "default" : "outline"}
              onClick={() => setAction("exit")}
            >
              <LogOut className="h-4 w-4 mr-2" />퇴근
            </Button>
          </div>

          <div>
            <Label className="text-xs">이름</Label>
            <IMESafeInput value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
          </div>
          <div>
            <Label className="text-xs">연락처(휴대폰)</Label>
            <IMESafeInput
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="01012345678"
              inputMode="numeric"
            />
          </div>

          {action === "entry" ? (
            <div className="space-y-2 border-t pt-3">
              <div className="text-xs font-semibold">필수 확인</div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={raOk} onCheckedChange={(v) => setRaOk(!!v)} />
                위험성평가 내용을 확인했습니다
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={eduOk} onCheckedChange={(v) => setEduOk(!!v)} />
                안전교육을 이수했습니다
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={tbmOk} onCheckedChange={(v) => setTbmOk(!!v)} />
                오늘 TBM 브리핑을 들었습니다
              </label>
            </div>
          ) : (
            <div className="space-y-2 border-t pt-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={noAcc} onCheckedChange={(v) => setNoAcc(!!v)} />
                금일 무재해로 작업을 완료했습니다
              </label>
            </div>
          )}

          <div>
            <Label className="text-xs">서명</Label>
            <ResponsiveSignaturePad ref={sigRef} height={140} className="border rounded" />
            <div className="text-right">
              <Button variant="ghost" size="sm" onClick={() => sigRef.current?.clear()}>지우기</Button>
            </div>
          </div>

          <Button className="w-full" disabled={submitting} onClick={submit}>
            {submitting ? "전송 중..." : action === "entry" ? "출근 기록" : "퇴근 기록"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
