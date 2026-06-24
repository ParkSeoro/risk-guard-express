import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { OctagonAlert } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export default function MobileWorkStop() {
  const { user } = useAuth();
  const [projectId, setProjectId] = useState<string | null>(null);
  const [form, setForm] = useState({ reporter_name: "", location: "", hazard_description: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const pid = localStorage.getItem("selectedProjectId");
    setProjectId(pid);
    if (user) {
      supabase.from("profiles").select("name").eq("id", user.id).maybeSingle().then(({ data }) => {
        if (data?.name) setForm(f => ({ ...f, reporter_name: data.name as string }));
      });
    }
  }, [user]);

  async function submit() {
    if (!projectId) { toast.error("프로젝트 선택이 필요합니다"); return; }
    if (!form.reporter_name.trim() || !form.hazard_description.trim()) {
      toast.error("보고자명·위험상황은 필수입니다"); return;
    }
    setSubmitting(true);
    const { error } = await supabase.from("work_stop_requests").insert({
      project_id: projectId,
      reporter_name: form.reporter_name.trim(),
      location: form.location || null,
      hazard_description: form.hazard_description.trim(),
      status: '접수',
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    toast.success("작업중지 요청이 즉시 관리자에게 전달되었습니다");
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="min-h-screen p-4 flex items-center justify-center bg-background">
        <Card className="max-w-md w-full"><CardContent className="p-6 text-center space-y-3">
          <OctagonAlert className="size-12 text-destructive mx-auto" />
          <h2 className="text-lg font-bold">작업중지 요청 전송됨</h2>
          <p className="text-sm text-muted-foreground">관리자가 즉시 확인합니다.<br/>법적으로 보호되며, 어떠한 불이익도 받지 않습니다 (산안법 §54-2).</p>
          <Button onClick={() => { setSubmitted(false); setForm({ ...form, location: "", hazard_description: "" }); }}>새 요청</Button>
        </CardContent></Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 bg-background space-y-4">
      <header className="text-center pt-4">
        <OctagonAlert className="size-12 text-destructive mx-auto" />
        <h1 className="text-xl font-bold mt-2">작업중지권 행사</h1>
        <p className="text-xs text-muted-foreground mt-1">산안법 §54 — 위험상황 발견 즉시 작업을 중지하고 보고하세요</p>
      </header>

      <Card><CardContent className="p-4 space-y-3">
        <div><Label>보고자명 *</Label><Input value={form.reporter_name} onChange={e => setForm({ ...form, reporter_name: e.target.value })} /></div>
        <div><Label>위치</Label><Input value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} placeholder="예: 3층 동측 비계" /></div>
        <div><Label>위험상황 설명 *</Label><Textarea rows={5} value={form.hazard_description} onChange={e => setForm({ ...form, hazard_description: e.target.value })} placeholder="어떤 급박한 위험이 있는지 구체적으로 작성하세요" /></div>
        <Button onClick={submit} disabled={submitting} className="w-full bg-destructive hover:bg-destructive/90 text-destructive-foreground">
          🛑 작업중지 요청
        </Button>
      </CardContent></Card>

      <div className="text-xs text-muted-foreground p-3">
        ⚠️ 사업주는 작업중지권 행사 근로자에게 해고·전보·임금삭감 등 어떠한 불리한 처우도 할 수 없습니다.
      </div>
    </div>
  );
}
