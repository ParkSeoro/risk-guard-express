import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QRCodeSVG } from "qrcode.react";
import { HardHat, QrCode, UserPlus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function WorkerManagement() {
  const [projectId, setProjectId] = useState<string>(() => localStorage.getItem("currentProjectId") || "");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [showQr, setShowQr] = useState(false);
  const baseUrl = window.location.origin;
  const registerUrl = projectId ? `${baseUrl}/worker/register?project=${projectId}` : "";

  useEffect(() => {
    supabase.from("projects").select("id,name").then(({ data }) => setProjects(data || []));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem("currentProjectId", projectId);
    load();
  }, [projectId]);

  const load = async () => {
    const { data, error } = await supabase
      .from("workers")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error) { toast.error(error.message); return; }
    setWorkers(data || []);
  };

  const remove = async (id: string) => {
    if (!confirm("삭제하시겠습니까?")) return;
    const { error } = await supabase.from("workers").update({ is_active: false }).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("비활성화 완료");
    load();
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center gap-2 flex-wrap">
        <h1 className="text-2xl font-bold flex items-center gap-2"><HardHat className="h-6 w-6" /> 근로자 관리</h1>
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger className="w-64"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
          <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
        </Select>
        {projectId && (
          <Button onClick={() => setShowQr(true)}><QrCode className="h-4 w-4 mr-2" />등록 QR 표시</Button>
        )}
      </div>

      {projectId && (
        <Card>
          <CardHeader><CardTitle>등록 근로자 ({workers.length}명)</CardTitle></CardHeader>
          <CardContent>
            {workers.length === 0 ? (
              <div className="text-sm text-muted-foreground py-8 text-center">아직 등록된 근로자가 없습니다.<br />상단의 "등록 QR 표시" 버튼으로 QR을 표시하면 근로자가 직접 등록합니다.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-2">이름</th>
                      <th className="text-left p-2">전화</th>
                      <th className="text-left p-2">소속사</th>
                      <th className="text-left p-2">교육확인</th>
                      <th className="text-left p-2">상태</th>
                      <th className="p-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {workers.map(w => (
                      <tr key={w.id} className="border-b">
                        <td className="p-2 font-medium">{w.name}</td>
                        <td className="p-2">{w.phone}</td>
                        <td className="p-2">{w.company_name}</td>
                        <td className="p-2">{w.education_confirmed_at ? <Badge className="bg-success">확인</Badge> : <Badge variant="secondary">미확인</Badge>}</td>
                        <td className="p-2">{w.is_active ? <Badge>활성</Badge> : <Badge variant="outline">비활성</Badge>}</td>
                        <td className="p-2">
                          <Button size="icon" variant="ghost" onClick={() => remove(w.id)}><Trash2 className="h-4 w-4" /></Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Dialog open={showQr} onOpenChange={setShowQr}>
        <DialogContent>
          <DialogHeader><DialogTitle>근로자 등록 QR</DialogTitle></DialogHeader>
          <div className="flex flex-col items-center gap-3 p-4">
            {registerUrl && <QRCodeSVG value={registerUrl} size={240} level="H" />}
            <div className="text-xs text-muted-foreground break-all text-center">{registerUrl}</div>
            <Button variant="outline" onClick={() => { navigator.clipboard.writeText(registerUrl); toast.success("링크 복사됨"); }}>링크 복사</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
