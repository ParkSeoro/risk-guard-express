import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Heart, ArrowLeft } from "lucide-react";

const SYMPTOMS = [
  "두통", "어지러움", "가슴통증", "호흡곤란", "근육통",
  "발열", "메스꺼움", "피로감 심함", "수면부족", "기타",
];

export default function MobileDailyHealthLog() {
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { profile } = useAuth();
  const { projectId } = useMobileAccess();
  const paramWorkerId = params.get("worker") || "";
  const [workerId, setWorkerId] = useState(paramWorkerId);
  const [worker, setWorker] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bodyTemp, setBodyTemp] = useState<string>("");
  const [bpSys, setBpSys] = useState<string>("");
  const [bpDia, setBpDia] = useState<string>("");
  const [sleep, setSleep] = useState<string>("");
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [fitToWork, setFitToWork] = useState(true);
  const [note, setNote] = useState("");
  const [alreadyToday, setAlreadyToday] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      let wid = paramWorkerId;
      // Resolve logged-in worker by phone + selected project when ?worker= missing
      if (!wid && profile?.phone && projectId) {
        const digits = profile.phone.replace(/\D/g, "");
        const { data: workers } = await supabase
          .from("workers")
          .select("id, phone")
          .eq("project_id", projectId)
          .eq("is_active", true)
          .limit(200);
        wid =
          (workers || []).find((w) => (w.phone || "").replace(/\D/g, "") === digits)?.id || "";
      }
      setWorkerId(wid);
      if (!wid) {
        setWorker(null);
        setLoading(false);
        return;
      }
      const today = new Date().toISOString().slice(0, 10);
      const [{ data: w }, { data: existing }] = await Promise.all([
        supabase.from("workers").select("*").eq("id", wid).maybeSingle(),
        supabase.from("worker_daily_health_logs").select("id").eq("worker_id", wid).eq("log_date", today).maybeSingle(),
      ]);
      setWorker(w);
      setAlreadyToday(!!existing);
      setLoading(false);
    })();
  }, [paramWorkerId, profile?.phone, projectId]);

  const toggleSymptom = (s: string) => {
    setSymptoms((cur) => cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]);
  };

  const submit = async () => {
    if (!worker) return;
    if (!bodyTemp) { toast.error("체온을 입력하세요"); return; }
    setSaving(true);
    const reason = (worker.health_grade || "").startsWith("D") ? "health_d" : "age65";
    const { error } = await supabase.from("worker_daily_health_logs").insert({
      worker_id: worker.id,
      project_id: worker.project_id,
      body_temp: Number(bodyTemp),
      bp_systolic: bpSys ? Number(bpSys) : null,
      bp_diastolic: bpDia ? Number(bpDia) : null,
      sleep_hours: sleep ? Number(sleep) : null,
      symptoms,
      fit_to_work: fitToWork,
      reason,
      note: note || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("오늘 일일 건강일지가 저장되었습니다");

    // 이상 소견 시 관리자에게 알림
    if (!fitToWork || symptoms.length >= 2 || Number(bodyTemp) >= 37.5) {
      const { data: mgrs } = await supabase
        .from("project_members")
        .select("user_id")
        .eq("project_id", worker.project_id)
        .in("role_new", ["project_admin", "safety_manager"]);
      if (mgrs && mgrs.length > 0) {
        await supabase.from("notifications").insert(mgrs.map((m: any) => ({
          user_id: m.user_id,
          type: "health_warning",
          title: `일일 건강일지 이상소견: ${worker.name}`,
          message: `${fitToWork ? "" : "[작업제한] "}체온 ${bodyTemp}°C${symptoms.length ? ` / 증상: ${symptoms.join(", ")}` : ""}`,
          related_id: worker.id,
          related_type: "worker",
        })));
      }
    }
    nav(-1);
  };

  if (loading) return <div className="p-8 text-center text-muted-foreground">로딩 중...</div>;
  if (!worker) return <div className="p-8 text-center">근로자 정보를 찾을 수 없습니다.</div>;

  return (
    <div className="min-h-screen bg-background p-4 space-y-4 max-w-md mx-auto">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => nav(-1)}><ArrowLeft className="h-4 w-4" /></Button>
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Heart className="h-5 w-5 text-destructive" /> 일일 건강일지
        </h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{worker.name} ({worker.company_name})</CardTitle>
          {alreadyToday && <p className="text-xs text-warning">오늘 이미 작성한 일지가 있습니다. 추가 저장은 불가합니다.</p>}
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>체온 (°C) *</Label>
            <Input type="number" step="0.1" inputMode="decimal" value={bodyTemp} onChange={(e) => setBodyTemp(e.target.value)} placeholder="36.5" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>혈압 (수축기)</Label><Input type="number" inputMode="numeric" value={bpSys} onChange={(e) => setBpSys(e.target.value)} placeholder="120" /></div>
            <div><Label>혈압 (이완기)</Label><Input type="number" inputMode="numeric" value={bpDia} onChange={(e) => setBpDia(e.target.value)} placeholder="80" /></div>
          </div>
          <div>
            <Label>수면 시간</Label>
            <Input type="number" step="0.5" inputMode="decimal" value={sleep} onChange={(e) => setSleep(e.target.value)} placeholder="7" />
          </div>
          <div>
            <Label>증상 체크</Label>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {SYMPTOMS.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={symptoms.includes(s)} onCheckedChange={() => toggleSymptom(s)} />
                  {s}
                </label>
              ))}
            </div>
          </div>
          <div>
            <Label>작업 가능 여부</Label>
            <div className="flex gap-2 mt-2">
              <Button type="button" variant={fitToWork ? "default" : "outline"} className="flex-1" onClick={() => setFitToWork(true)}>작업 가능</Button>
              <Button type="button" variant={!fitToWork ? "destructive" : "outline"} className="flex-1" onClick={() => setFitToWork(false)}>작업 제한 필요</Button>
            </div>
          </div>
          <div>
            <Label>비고</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="특이사항이 있으면 작성" rows={2} />
          </div>
          <Button onClick={submit} disabled={saving || alreadyToday} className="w-full">
            {saving ? "저장 중..." : "오늘 일지 저장"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
