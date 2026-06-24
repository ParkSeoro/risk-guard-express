import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QRCodeSVG } from "qrcode.react";
import { QrCode, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/**
 * 일일 QR 발급/인쇄 — 매일 출퇴근용 QR을 근로자별로 발급하고 카드 형태로 인쇄.
 * issue_daily_qr() RPC를 사용해 당일 자정 만료 QR을 생성한다.
 */
export default function WorkerDailyQR() {
  const [projectId, setProjectId] = useState<string>(() => localStorage.getItem("currentProjectId") || "");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [companyFilter, setCompanyFilter] = useState<string>("__all__");
  const [workers, setWorkers] = useState<any[]>([]);
  const [qrMap, setQrMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const baseUrl = window.location.origin;

  useEffect(() => {
    supabase.from("projects").select("id,name").then(({ data }) => setProjects(data || []));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem("currentProjectId", projectId);
    supabase.from("companies").select("id,name").eq("project_id", projectId).eq("is_deleted", false).order("name")
      .then(({ data }) => setCompanies(data || []));
    loadWorkers();
  }, [projectId]);

  useEffect(() => { if (workers.length) loadExistingQrs(); }, [workers]);

  const loadWorkers = async () => {
    const { data } = await supabase.from("workers")
      .select("id,name,phone,company_id,company_name")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .order("name");
    setWorkers(data || []);
  };

  const loadExistingQrs = async () => {
    const ids = workers.map(w => w.id);
    if (!ids.length) return;
    const { data } = await supabase.from("worker_daily_qr")
      .select("worker_id,qr_token,expires_at,used_for_entry,used_for_exit")
      .in("worker_id", ids)
      .eq("work_date", today);
    const map: Record<string, any> = {};
    (data || []).forEach((q: any) => { map[q.worker_id] = q; });
    setQrMap(map);
  };

  const filtered = workers.filter(w =>
    companyFilter === "__all__" || w.company_id === companyFilter
  );

  const issueAll = async () => {
    setLoading(true);
    let ok = 0, fail = 0;
    let lastErr = "";
    for (const w of filtered) {
      const { data, error } = await supabase.rpc("issue_daily_qr", { _worker_id: w.id });
      if (error) { fail++; lastErr = error.message; continue; }
      if ((data as any)?.error) { fail++; lastErr = (data as any).error; continue; }
      ok++;
    }
    setLoading(false);
    if (fail) toast.error(`${ok}건 발급, ${fail}건 실패: ${lastErr}`);
    else toast.success(`${ok}건 발급 완료`);
    loadExistingQrs();
  };


  const printAll = () => window.print();

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap gap-2 items-end print:hidden">
        <div>
          <div className="text-xs text-muted-foreground mb-1">프로젝트</div>
          <Select value={projectId} onValueChange={setProjectId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="프로젝트 선택" /></SelectTrigger>
            <SelectContent>{projects.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <div className="text-xs text-muted-foreground mb-1">소속사</div>
          <Select value={companyFilter} onValueChange={setCompanyFilter}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">전체</SelectItem>
              {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={issueAll} disabled={!filtered.length || loading}>
          <RefreshCw className="h-4 w-4 mr-2" />오늘({today}) QR 일괄 발급
        </Button>
        <Button variant="outline" onClick={printAll} disabled={!Object.keys(qrMap).length}>
          <Printer className="h-4 w-4 mr-2" />인쇄
        </Button>
      </div>

      <Card className="print:shadow-none print:border-0">
        <CardHeader className="print:hidden">
          <CardTitle className="flex items-center gap-2">
            <QrCode className="h-5 w-5" /> {today} 일일 QR ({filtered.filter(w => qrMap[w.id]).length}/{filtered.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!filtered.length ? (
            <div className="text-sm text-muted-foreground py-8 text-center">근로자가 없습니다.</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 print:grid-cols-3">
              {filtered.map(w => {
                const q = qrMap[w.id];
                const portalUrl = q ? `${baseUrl}/worker-portal?token=${q.qr_token}` : "";
                return (
                  <div key={w.id} className="border rounded-lg p-3 flex flex-col items-center text-center break-inside-avoid">
                    <div className="text-sm font-semibold">{w.name}</div>
                    <div className="text-[11px] text-muted-foreground">{w.company_name || '-'}</div>
                    <div className="my-2">
                      {q ? (
                        <QRCodeSVG value={portalUrl} size={140} level="H" />
                      ) : (
                        <div className="w-[140px] h-[140px] flex items-center justify-center bg-muted text-xs text-muted-foreground rounded">미발급</div>
                      )}
                    </div>
                    {q && (
                      <div className="flex gap-1 text-[10px]">
                        <Badge variant={q.used_for_entry ? "default" : "outline"}>입장 {q.used_for_entry ? '✓' : ''}</Badge>
                        <Badge variant={q.used_for_exit ? "default" : "outline"}>퇴장 {q.used_for_exit ? '✓' : ''}</Badge>
                      </div>
                    )}
                    <div className="text-[9px] text-muted-foreground mt-1">{today}</div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
