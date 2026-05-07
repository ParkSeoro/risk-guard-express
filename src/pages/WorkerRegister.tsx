import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, HardHat, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

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
  const [submitting, setSubmitting] = useState(false);

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
    localStorage.setItem("workerToken", result.qr_token);
    toast.success("등록 완료");
    navigate(`/worker/portal/${result.qr_token}`);
  };

  if (!projectId) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">잘못된 링크입니다.</div>;
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
          <Button className="w-full h-14 text-lg" onClick={submit} disabled={submitting}>
            {submitting && <Loader2 className="h-5 w-5 mr-2 animate-spin" />}등록하기
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
