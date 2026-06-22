import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import SignatureCanvas from "react-signature-canvas";
import { QRCodeCanvas } from "qrcode.react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, HardHat, FileText, LogIn, LogOut, AlertCircle, CheckCircle2, QrCode } from "lucide-react";
import { toast } from "sonner";

type WorkerInfo = {
  id: string;
  project_id: string;
  company_id?: string;
  company_name?: string;
  name: string;
  phone: string;
  education_confirmed_at?: string | null;
};

type DailyQR = {
  qr_token: string;
  work_date: string;
  expires_at: string;
  used_for_entry: boolean;
  used_for_exit: boolean;
};

export default function WorkerPortal() {
  const { token } = useParams();
  const [worker, setWorker] = useState<WorkerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [materials, setMaterials] = useState<any[]>([]);
  const [daily, setDaily] = useState<DailyQR | null>(null);
  const sigEntry = useRef<SignatureCanvas>(null);
  const sigExit = useRef<SignatureCanvas>(null);
  const [raCheck, setRaCheck] = useState(false);
  const [eduCheck, setEduCheck] = useState(false);
  const [tbmCheck, setTbmCheck] = useState(false);
  const [noAccident, setNoAccident] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadDaily = async (workerId: string) => {
    const { data } = await supabase.rpc("issue_daily_qr", { _worker_id: workerId });
    const r = data as any;
    if (r?.success) {
      setDaily({
        qr_token: r.qr_token,
        work_date: r.work_date,
        expires_at: r.expires_at,
        used_for_entry: r.used_for_entry,
        used_for_exit: r.used_for_exit,
      });
    }
  };

  useEffect(() => {
    if (!token) return;
    (async () => {
      const { data, error } = await supabase.rpc("get_worker_by_token", { _token: token });
      setLoading(false);
      if (error || (data as any)?.error) {
        toast.error("등록되지 않은 토큰입니다");
        return;
      }
      const w = data as WorkerInfo;
      setWorker(w);
      await loadDaily(w.id);
      const { data: mats } = await supabase
        .from("safety_education_materials")
        .select("id,title,work_overview,key_hazards")
        .eq("project_id", w.project_id)
        .order("created_at", { ascending: false })
        .limit(5);
      setMaterials(mats || []);
    })();
  }, [token]);

  const confirmEducation = async () => {
    if (!token) return;
    const { error } = await supabase.rpc("confirm_worker_education", { _token: token });
    if (error) { toast.error(error.message); return; }
    setWorker(w => w ? { ...w, education_confirmed_at: new Date().toISOString() } : w);
    toast.success("교육 확인 완료");
  };

  const doScan = async (action: "entry" | "exit", sig: string, ack: boolean) => {
    return await supabase.rpc("worker_daily_scan", {
      _token: daily!.qr_token,
      _action: action,
      _signature: sig,
      _ra_confirmed: raCheck,
      _edu_confirmed: eduCheck,
      _tbm_confirmed: tbmCheck,
      _no_accident: noAccident,
      _ack_warnings: ack,
    });
  };

  const submitScan = async (action: "entry" | "exit") => {
    if (!daily || !worker) return;
    const sigRef = action === "entry" ? sigEntry : sigExit;
    if (sigRef.current?.isEmpty()) { toast.error("서명을 입력해주세요"); return; }
    if (action === "entry" && (!raCheck || !eduCheck)) {
      toast.error("위험성평가/교육 확인이 필요합니다"); return;
    }
    if (action === "exit" && !noAccident) { toast.error("무재해 확인이 필요합니다"); return; }

    const sig = sigRef.current!.getCanvas().toDataURL("image/png");
    setSubmitting(true);
    let { data, error } = await doScan(action, sig, false);
    let r = data as any;

    if (!error && r?.warning && Array.isArray(r?.warnings) && r.warnings.length > 0) {
      const lines = r.warnings.map((w: any) => `• ${w.message}`).join("\n");
      const ok = window.confirm(`주의: 미이수 항목이 확인되었습니다.\n${lines}\n\n관리자에게 자동 알림이 발송됩니다. 계속 진행하시겠습니까?`);
      if (!ok) { setSubmitting(false); return; }
      ({ data, error } = await doScan(action, sig, true));
      r = data as any;
    }

    setSubmitting(false);
    if (error || r?.error) {
      toast.error((action === "entry" ? "출근" : "퇴근") + " 실패: " + (r?.message || r?.error || error?.message));
      return;
    }
    if (action === "entry" && Array.isArray(r?.warnings) && r.warnings.length > 0) {
      toast.warning("출근 완료 (미이수 항목이 관리자에게 통보되었습니다)");
    } else {
      toast.success(action === "entry" ? "출근 완료" : "퇴근 완료. 수고하셨습니다.");
    }
    await loadDaily(worker.id);
    sigRef.current?.clear();
    if (action === "exit") setNoAccident(false);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!worker) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">등록된 근로자가 아닙니다.</div>;

  const eduOk = !!worker.education_confirmed_at;
  const expired = daily ? new Date(daily.expires_at) < new Date() : false;
  const canEntry = !!daily && !daily.used_for_entry && !expired && eduOk;
  const canExit = !!daily && daily.used_for_entry && !daily.used_for_exit && !expired;

  return (
    <div className="min-h-screen bg-muted/30 p-4">
      <div className="max-w-2xl mx-auto space-y-4">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
                <HardHat className="h-6 w-6 text-primary-foreground" />
              </div>
              <div className="flex-1">
                <CardTitle>{worker.name}</CardTitle>
                <div className="text-xs text-muted-foreground">{worker.company_name} · {worker.phone}</div>
              </div>
              {daily?.used_for_exit ? (
                <Badge variant="secondary">퇴근완료</Badge>
              ) : daily?.used_for_entry ? (
                <Badge className="bg-success">출근중</Badge>
              ) : (
                <Badge variant="outline">대기</Badge>
              )}
            </div>
          </CardHeader>
        </Card>

        {/* 오늘의 QR */}
        {daily && (
          <Card className="border-primary/40">
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <QrCode className="h-4 w-4" /> 오늘의 QR ({daily.work_date})
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-2 pb-4">
              <div className="bg-white p-3 rounded border">
                <QRCodeCanvas value={daily.qr_token} size={180} />
              </div>
              <div className="text-xs text-muted-foreground">
                {expired ? "만료됨 — 새로고침하여 다시 발급받으세요" : `자정까지 유효 · 안전관리자에게 보여줄 수 있습니다`}
              </div>
              <div className="flex gap-3 text-xs">
                <span>출근: {daily.used_for_entry ? "✓" : "—"}</span>
                <span>퇴근: {daily.used_for_exit ? "✓" : "—"}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {!eduOk && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="pt-4 flex gap-2">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
              <div className="text-sm"><strong>교육 확인 필요</strong> — 아래 [교육] 탭에서 확인하세요.</div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue={!eduOk ? "education" : canEntry ? "entry" : "exit"}>
          <TabsList className="grid grid-cols-3 w-full h-12">
            <TabsTrigger value="education" className="text-base"><FileText className="h-5 w-5 mr-1" />교육</TabsTrigger>
            <TabsTrigger value="entry" className="text-base" disabled={!canEntry}><LogIn className="h-5 w-5 mr-1" />출근</TabsTrigger>
            <TabsTrigger value="exit" className="text-base" disabled={!canExit}><LogOut className="h-5 w-5 mr-1" />퇴근</TabsTrigger>
          </TabsList>

          <TabsContent value="education">
            <Card>
              <CardContent className="pt-4 space-y-3">
                {materials.length === 0 ? (
                  <div className="text-sm text-muted-foreground">등록된 교육자료가 없습니다.</div>
                ) : materials.slice(0, 1).map(m => (
                  <div key={m.id} className="space-y-2">
                    <div className="font-bold text-lg">{m.title}</div>
                    <div className="text-sm whitespace-pre-wrap">{m.work_overview}</div>
                    {(m.key_hazards || []).slice(0, 5).map((h: any, i: number) => (
                      <div key={i} className="border rounded p-2 text-sm">
                        <Badge variant={h.risk_level === "상" ? "destructive" : "secondary"} className="mr-2">{h.risk_level}</Badge>
                        <strong>{h.hazard}</strong>: {h.description}
                      </div>
                    ))}
                  </div>
                ))}
                <Button onClick={confirmEducation} disabled={eduOk} className="w-full h-14 text-lg">
                  {eduOk ? <><CheckCircle2 className="h-5 w-5 mr-2" />교육 확인 완료</> : "확인했습니다"}
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="entry">
            <Card>
              <CardContent className="pt-4 space-y-3">
                <Label className="flex items-center gap-2 text-base">
                  <Checkbox
                    checked={raCheck && eduCheck && tbmCheck}
                    onCheckedChange={v => { setRaCheck(!!v); setEduCheck(!!v); setTbmCheck(!!v); }}
                  />
                  위험성평가 · 교육 · TBM 모두 확인
                </Label>
                <div>
                  <Label className="text-base">서명</Label>
                  <div className="border-2 rounded bg-white">
                    <SignatureCanvas ref={sigEntry} canvasProps={{ className: "w-full h-40" }} />
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => sigEntry.current?.clear()}>지우기</Button>
                </div>
                <Button className="w-full h-14 text-lg" onClick={() => submitScan("entry")} disabled={submitting || !canEntry}>
                  {submitting && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}<LogIn className="h-5 w-5 mr-2" />출근
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="exit">
            <Card>
              <CardContent className="pt-4 space-y-3">
                <Label className="flex items-center gap-2 text-base">
                  <Checkbox checked={noAccident} onCheckedChange={v => setNoAccident(!!v)} />
                  <strong>무재해 확인</strong>
                </Label>
                <div>
                  <Label className="text-base">서명</Label>
                  <div className="border-2 rounded bg-white">
                    <SignatureCanvas ref={sigExit} canvasProps={{ className: "w-full h-40" }} />
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => sigExit.current?.clear()}>지우기</Button>
                </div>
                <Button className="w-full h-14 text-lg" onClick={() => submitScan("exit")} disabled={submitting || !canExit}>
                  {submitting && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}<LogOut className="h-5 w-5 mr-2" />퇴근
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
