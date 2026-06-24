import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { QRCodeSVG } from "qrcode.react";
import { HardHat, QrCode, Trash2, ExternalLink, Settings2, AlertTriangle, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import WorkerAttendance from "./WorkerAttendance";
import WorkerBulkImportDialog from "@/components/workers/WorkerBulkImportDialog";

const RESTRICTED_ROLES = new Set(["site_manager", "supervisor", "worker"]);

export default function WorkerManagement() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") === "attendance" ? "attendance" : "register";
  const [tab, setTab] = useState<string>(initialTab);

  const [projectId, setProjectId] = useState<string>(() => localStorage.getItem("currentProjectId") || "");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [companyLocked, setCompanyLocked] = useState(false);
  const [workers, setWorkers] = useState<any[]>([]);
  const [showQr, setShowQr] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const baseUrl = window.location.origin;
  const registerUrl = projectId
    ? `${baseUrl}/worker/register?project=${projectId}${companyId ? `&company=${companyId}` : ''}`
    : "";

  useEffect(() => {
    supabase.from("projects").select("id,name").then(({ data }) => setProjects(data || []));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem("currentProjectId", projectId);
    setCompanyId("");
    setCompanyLocked(false);
    supabase.from("companies").select("id,name").eq("project_id", projectId).order("name")
      .then(({ data }) => setCompanies(data || []));
    // 관리자 소속사 자동 지정 — 협력사 권한이면 잠금, 전체권한이면 기본값만 채우고 변경 가능
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) return;
      const { data: pm } = await supabase
        .from("project_members")
        .select("role_new, company_id")
        .eq("user_id", auth.user.id)
        .eq("project_id", projectId)
        .maybeSingle();
      if (pm?.company_id) {
        setCompanyId(pm.company_id);
        if (pm.role_new && RESTRICTED_ROLES.has(pm.role_new as string)) {
          setCompanyLocked(true);
        }
      }
    })();
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

  const onTabChange = (v: string) => {
    setTab(v);
    const p = new URLSearchParams(searchParams);
    if (v === "attendance") p.set("tab", "attendance"); else p.delete("tab");
    setSearchParams(p, { replace: true });
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <HardHat className="h-6 w-6" /> 근로자 관리
      </h1>

      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList>
          <TabsTrigger value="register">등록 정보</TabsTrigger>
          <TabsTrigger value="attendance">입퇴장 현황</TabsTrigger>
        </TabsList>

        <TabsContent value="register" className="space-y-4 mt-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-64"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
              <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
            </Select>
            {projectId && (
              <>
                <Button onClick={() => setShowQr(true)}><QrCode className="h-4 w-4 mr-2" />등록 QR 표시</Button>
                <Button variant="secondary" onClick={() => setShowBulk(true)}><FileSpreadsheet className="h-4 w-4 mr-2" />엑셀 일괄등록</Button>
                <Link to="/workers/legal-mapping"><Button variant="outline"><Settings2 className="h-4 w-4 mr-2" />법정 교육 매핑</Button></Link>
              </>
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
                          <th className="text-left p-2">직종</th>
                          <th className="text-left p-2">교육확인</th>
                          <th className="text-left p-2">대상</th>
                          <th className="text-left p-2">상태</th>
                          <th className="p-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {workers.map(w => (
                          <tr key={w.id} className="border-b hover:bg-muted/40">
                            <td className="p-2 font-medium">
                              <Link to={`/workers/${w.id}`} className="text-primary hover:underline">{w.name}</Link>
                            </td>
                            <td className="p-2">{w.phone}</td>
                            <td className="p-2">{w.company_name}</td>
                            <td className="p-2 text-xs">{w.job_type || "-"}</td>
                            <td className="p-2">{w.education_confirmed_at ? <Badge className="bg-success">확인</Badge> : <Badge variant="secondary">미확인</Badge>}</td>
                            <td className="p-2">
                              {w.requires_daily_health_log && <Badge variant="outline" className="gap-1 text-warning border-warning"><AlertTriangle className="h-3 w-3" />일일일지</Badge>}
                            </td>
                            <td className="p-2">{w.is_active ? <Badge>활성</Badge> : <Badge variant="outline">비활성</Badge>}</td>
                            <td className="p-2 flex gap-1">
                              <Link to={`/workers/${w.id}`}><Button size="icon" variant="ghost"><ExternalLink className="h-4 w-4" /></Button></Link>
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
        </TabsContent>

        <TabsContent value="attendance" className="mt-4">
          <WorkerAttendance />
        </TabsContent>
      </Tabs>

      <Dialog open={showQr} onOpenChange={setShowQr}>
        <DialogContent>
          <DialogHeader><DialogTitle>근로자 등록 QR</DialogTitle></DialogHeader>
          <div className="flex flex-col items-center gap-3 p-4">
            <div className="w-full">
              <Select
                value={companyId || "__none__"}
                onValueChange={(v) => setCompanyId(v === "__none__" ? "" : v)}
                disabled={companyLocked}
              >
                <SelectTrigger><SelectValue placeholder="소속사 자동 지정 (선택)" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">소속사 미지정 (근로자가 직접 입력)</SelectItem>
                  {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="text-[11px] text-muted-foreground mt-1">
                {companyLocked
                  ? "협력사 권한이라 본인 소속사로 자동 지정됩니다 (변경 불가)."
                  : "선택된 회사가 QR에 포함되어 자동 지정됩니다."}
              </div>
            </div>
            {registerUrl && <QRCodeSVG value={registerUrl} size={240} level="H" />}
            <div className="text-xs text-muted-foreground break-all text-center">{registerUrl}</div>
            <Button variant="outline" onClick={() => { navigator.clipboard.writeText(registerUrl); toast.success("링크 복사됨"); }}>링크 복사</Button>
          </div>
        </DialogContent>
      </Dialog>

      <WorkerBulkImportDialog
        projectId={projectId}
        defaultCompanyId={companyLocked ? companyId : undefined}
        open={showBulk}
        onClose={() => setShowBulk(false)}
        onDone={load}
      />
    </div>
  );
}
