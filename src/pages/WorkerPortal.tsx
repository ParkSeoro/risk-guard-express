import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import SignatureCanvas from "react-signature-canvas";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, HardHat, ShieldCheck, FileText, LogIn, LogOut, AlertCircle, CheckCircle2 } from "lucide-react";
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

export default function WorkerPortal() {
  const { token } = useParams();
  const [worker, setWorker] = useState<WorkerInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [materials, setMaterials] = useState<any[]>([]);
  const [openLog, setOpenLog] = useState<any | null>(null);
  const [activePermit, setActivePermit] = useState<any | null>(null);
  const sigEntry = useRef<SignatureCanvas>(null);
  const sigExit = useRef<SignatureCanvas>(null);
  const [raCheck, setRaCheck] = useState(false);
  const [eduCheck, setEduCheck] = useState(false);
  const [tbmCheck, setTbmCheck] = useState(false);
  const [noAccident, setNoAccident] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
      // load education materials
      const { data: mats } = await supabase
        .from("safety_education_materials")
        .select("id,title,work_overview,key_hazards,safety_measures,prohibited_actions,ppe_requirements,tbm_summary")
        .eq("project_id", w.project_id)
        .order("created_at", { ascending: false })
        .limit(5);
      setMaterials(mats || []);
      // check open entry log today
      const today = new Date().toISOString().slice(0, 10);
      const { data: log } = await supabase
        .from("worker_entry_logs")
        .select("*")
        .eq("worker_id", w.id)
        .gte("entry_at", today + "T00:00:00")
        .is("exit_at", null)
        .order("entry_at", { ascending: false })
        .limit(1);
      if (log && log[0]) setOpenLog(log[0]);
      // active permit (today, approved, that includes this worker)
      const { data: permits } = await supabase
        .from("work_permit_workers")
        .select("work_permit_id, work_permits!inner(id, work_name, status, permit_date)")
        .eq("worker_id", w.id);
      const todayPermit = (permits as any[] || []).find(p => p.work_permits?.status === "승인" && p.work_permits?.permit_date === today);
      if (todayPermit) setActivePermit(todayPermit.work_permits);
    })();
  }, [token]);

  const confirmEducation = async () => {
    if (!token) return;
    const { error } = await supabase.rpc("confirm_worker_education", { _token: token });
    if (error) { toast.error(error.message); return; }
    setWorker(w => w ? { ...w, education_confirmed_at: new Date().toISOString() } : w);
    toast.success("교육 확인 완료");
  };

  const submitEntry = async () => {
    if (!token) return;
    if (sigEntry.current?.isEmpty()) { toast.error("서명을 입력해주세요"); return; }
    if (!raCheck || !eduCheck) { toast.error("위험성평가/교육 확인이 필요합니다"); return; }
    const sig = sigEntry.current!.getCanvas().toDataURL("image/png");
    setSubmitting(true);
    const { data, error } = await supabase.rpc("worker_entry", {
      _token: token,
      _work_permit_id: activePermit?.id || null,
      _signature: sig,
      _ra_confirmed: raCheck,
      _edu_confirmed: eduCheck,
      _tbm_confirmed: tbmCheck,
    });
    setSubmitting(false);
    const result = data as any;
    if (error || result?.error) { toast.error("입장 실패: " + (error?.message || result?.error)); return; }
    toast.success("입장 완료");
    setOpenLog({ id: result.log_id, entry_at: new Date().toISOString() });
  };

  const submitExit = async () => {
    if (!token) return;
    if (sigExit.current?.isEmpty()) { toast.error("서명을 입력해주세요"); return; }
    if (!noAccident) { toast.error("무재해 확인이 필요합니다"); return; }
    const sig = sigExit.current!.getCanvas().toDataURL("image/png");
    setSubmitting(true);
    const { data, error } = await supabase.rpc("worker_exit", {
      _token: token, _signature: sig, _no_accident: noAccident,
    });
    setSubmitting(false);
    const result = data as any;
    if (error || result?.error) { toast.error("퇴장 실패: " + (error?.message || result?.error)); return; }
    toast.success("퇴장 완료. 수고하셨습니다.");
    setOpenLog(null);
    setNoAccident(false);
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!worker) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">등록된 근로자가 아닙니다.</div>;

  const eduOk = !!worker.education_confirmed_at;
  const canEnter = !!activePermit && eduOk;

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
              {openLog ? (
                <Badge className="bg-success">입장중</Badge>
              ) : canEnter ? (
                <Badge variant="secondary">대기</Badge>
              ) : (
                <Badge variant="destructive">작업 불가</Badge>
              )}
            </div>
          </CardHeader>
        </Card>

        {!canEnter && !openLog && (
          <Card className="border-destructive/50 bg-destructive/5">
            <CardContent className="pt-4 flex gap-2">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
              <div className="text-sm">
                <strong>작업 불가</strong>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  {!activePermit && <li>당일 승인된 작업허가서가 없습니다</li>}
                  {!eduOk && <li>교육 확인이 필요합니다</li>}
                </ul>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue={openLog ? "exit" : (eduOk ? "entry" : "education")}>
          <TabsList className="grid grid-cols-3 w-full h-12">
            <TabsTrigger value="education" className="text-base"><FileText className="h-5 w-5 mr-1" />교육</TabsTrigger>
            <TabsTrigger value="entry" className="text-base" disabled={!!openLog}><LogIn className="h-5 w-5 mr-1" />입장</TabsTrigger>
            <TabsTrigger value="exit" className="text-base" disabled={!openLog}><LogOut className="h-5 w-5 mr-1" />퇴장</TabsTrigger>
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
                {activePermit && (
                  <div className="text-sm bg-muted p-2 rounded">
                    <strong>오늘 작업:</strong> {activePermit.work_name}
                  </div>
                )}
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
                <Button className="w-full h-14 text-lg" onClick={submitEntry} disabled={submitting || !canEnter}>
                  {submitting && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}<LogIn className="h-5 w-5 mr-2" />입장
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="exit">
            <Card>
              <CardContent className="pt-4 space-y-3">
                <div className="text-sm bg-muted p-2 rounded">
                  입장: {openLog && new Date(openLog.entry_at).toLocaleString("ko-KR")}
                </div>
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
                <Button className="w-full h-14 text-lg" onClick={submitExit} disabled={submitting}>
                  {submitting && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}<LogOut className="h-5 w-5 mr-2" />퇴장
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
