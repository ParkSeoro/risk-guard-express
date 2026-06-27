import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, HardHat, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { JOB_TYPE_LABELS } from "@/hooks/useWorker";
import RequiredEducationPanel from "@/components/worker/RequiredEducationPanel";

export default function WorkerRegister() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const projectId = params.get("project") || "";
  const companyIdParam = params.get("company") || "";
  const [projectName, setProjectName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [jobType, setJobType] = useState("general");
  const [hireDate, setHireDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [doneToken, setDoneToken] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    supabase.from("projects").select("name").eq("id", projectId).maybeSingle()
      .then(({ data }) => setProjectName(data?.name || ""));
    if (companyIdParam) {
      supabase.from("companies").select("name").eq("id", companyIdParam).maybeSingle()
        .then(({ data }) => setCompanyName(data?.name || ""));
    }
  }, [projectId, companyIdParam]);

  const submit = async () => {
    if (!projectId) { toast.error("잘못된 링크입니다"); return; }
    if (!name.trim() || phone.trim().length < 8) { toast.error("이름과 전화번호를 정확히 입력해주세요"); return; }
    setSubmitting(true);
    const { data, error } = await supabase.rpc("register_worker", {
      _project_id: projectId,
      _name: name.trim(),
      _phone: phone.trim(),
      _company_name: companyIdParam ? companyName : company.trim(),
      _company_id: companyIdParam || null,
    } as any);
    setSubmitting(false);
    if (error) { toast.error("등록 실패: " + error.message); return; }
    const result = data as any;
    if (result?.error) { toast.error("등록 실패: " + result.error); return; }
    // 신규 정보(생년월일/직종/입사일) 동기화 → 트리거가 의무사항 자동 생성
    if (result.worker_id && (birthDate || jobType || hireDate)) {
      await supabase.from("workers").update({
        birth_date: birthDate || null,
        job_type: jobType,
        hire_date: hireDate || new Date().toISOString().slice(0, 10),
      }).eq("id", result.worker_id);
    }
    localStorage.setItem("workerToken", result.qr_token);
    toast.success("등록 완료");
    setDoneToken(result.qr_token);
  };

  const tryClose = () => {
    window.close();
    setTimeout(() => {
      // If window.close() didn't work (most browsers block it), show guidance
      toast.info("브라우저 탭을 직접 닫아주세요");
    }, 300);
  };

  if (!projectId) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">잘못된 링크입니다.</div>;
  }

  if (doneToken) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-6 text-center space-y-4">
            <div className="mx-auto h-16 w-16 rounded-full bg-success/10 flex items-center justify-center">
              <CheckCircle2 className="h-10 w-10 text-success" />
            </div>
            <div className="text-2xl font-bold">등록 완료</div>
            <div className="text-muted-foreground">
              <strong>{name}</strong>님, 등록이 완료되었습니다.
            </div>
            <div className="text-sm text-muted-foreground bg-muted p-3 rounded">
              현장 입장 시 본인 QR을 다시 스캔하거나<br />아래 버튼으로 입퇴장 페이지를 여세요.
            </div>
            <div className="space-y-2 pt-2">
              <Button className="w-full h-14 text-lg" onClick={() => navigate(`/worker/portal/${doneToken}`)}>
                입퇴장 페이지로 이동
              </Button>
              <Button variant="outline" className="w-full h-12" onClick={tryClose}>
                창 닫기
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-lg bg-primary flex items-center justify-center">
              <HardHat className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <CardTitle>근로자 등록</CardTitle>
              <div className="text-sm text-muted-foreground">{projectName}</div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {companyIdParam && companyName && (
            <div className="bg-primary/10 border border-primary/30 rounded p-2 text-sm">
              소속사: <strong>{companyName}</strong> <span className="text-muted-foreground">(자동 지정)</span>
            </div>
          )}
          <div>
            <Label className="text-base">이름 *</Label>
            <Input className="h-12 text-lg" value={name} onChange={e => setName(e.target.value)} placeholder="홍길동" />
          </div>
          <div>
            <Label className="text-base">전화번호 *</Label>
            <Input className="h-12 text-lg" value={phone} onChange={e => setPhone(e.target.value)} placeholder="010-1234-5678" inputMode="tel" />
          </div>
          {!companyIdParam && (
            <div>
              <Label className="text-base">소속사</Label>
              <Input className="h-12 text-lg" value={company} onChange={e => setCompany(e.target.value)} placeholder="(주)○○건설" />
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-base">생년월일</Label>
              <Input type="date" className="h-12 text-base" value={birthDate} onChange={e => setBirthDate(e.target.value)} />
              <div className="text-[11px] text-muted-foreground mt-1">만 65세 이상 시 일일 건강일지 대상</div>
            </div>
            <div>
              <Label className="text-base">입사일</Label>
              <Input type="date" className="h-12 text-base" value={hireDate} onChange={e => setHireDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-base">직종</Label>
            <select className="w-full h-12 text-base border rounded-md px-3 bg-background" value={jobType} onChange={e => setJobType(e.target.value)}>
              <option value="general">일반작업</option>
              <option value="office">사무직</option>
              <option value="manager">관리감독자</option>
              <option value="hazardous">유해위험작업</option>
              <option value="chemical">화학물질 취급</option>
            </select>
            <div className="text-[11px] text-muted-foreground mt-1">직종에 따라 필수 법정 교육·건진이 자동 등록됩니다</div>
          </div>
          <Button className="w-full h-14 text-lg" onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}등록하기
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
