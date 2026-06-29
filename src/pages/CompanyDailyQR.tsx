import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QRCodeSVG } from "qrcode.react";
import { Building2, Printer, RefreshCw, Search, CheckCircle2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

/**
 * 시공사(회사)별 일일 게시판 QR — 관리자가 매일 출력해 게시판에 부착.
 * 근로자는 게시판 QR을 폰으로 스캔해 본인 이름/연락처를 입력하면 출입 기록이 생성된다.
 */
type StatusFilter = "all" | "issued" | "missing";

export default function CompanyDailyQR() {
  const [projectId] = useState<string>(() => localStorage.getItem("currentProjectId") || "");
  const [companies, setCompanies] = useState<any[]>([]);
  const [qrMap, setQrMap] = useState<Record<string, any>>({});
  const [loadingList, setLoadingList] = useState(true);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const today = new Date().toISOString().slice(0, 10);
  const baseUrl = window.location.origin;

  useEffect(() => {
    if (!projectId) return;
    (async () => {
      setLoadingList(true);
      const { data } = await supabase
        .from("companies")
        .select("id,name,company_type")
        .eq("project_id", projectId)
        .eq("is_deleted", false)
        .order("name");
      setCompanies(data || []);
      setLoadingList(false);
    })();
  }, [projectId]);

  const reloadQrs = async () => {
    if (!companies.length) return;
    const ids = companies.map((c) => c.id);
    const { data } = await supabase
      .from("company_daily_qr")
      .select("company_id,qr_token,expires_at,work_date")
      .in("company_id", ids)
      .eq("work_date", today);
    const map: Record<string, any> = {};
    (data || []).forEach((q: any) => { map[q.company_id] = q; });
    setQrMap(map);
  };

  useEffect(() => { reloadQrs(); /* eslint-disable-next-line */ }, [companies, today]);

  // Realtime: 다른 관리자가 발급 시 동기화
  useEffect(() => {
    if (!projectId || !companies.length) return;
    const ch = supabase
      .channel(`company_daily_qr:${projectId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "company_daily_qr" }, reloadQrs)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [projectId, companies.length]);

  const issueAll = async () => {
    if (!companies.length) return;
    setLoading(true);
    let ok = 0, fail = 0, lastErr = "";
    for (const c of companies) {
      const { data, error } = await supabase.rpc("issue_company_daily_qr", { _company_id: c.id });
      if (error) { fail++; lastErr = error.message; continue; }
      if ((data as any)?.error) { fail++; lastErr = (data as any).error; continue; }
      ok++;
    }
    setLoading(false);
    fail ? toast.error(`${ok}건 발급, ${fail}건 실패: ${lastErr}`) : toast.success(`${ok}건 발급 완료`);
    reloadQrs();
  };

  const issueOne = async (companyId: string) => {
    const { data, error } = await supabase.rpc("issue_company_daily_qr", { _company_id: companyId });
    if (error || (data as any)?.error) {
      toast.error(error?.message || (data as any)?.error || "발급 실패");
      return;
    }
    toast.success("발급 완료");
    reloadQrs();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companies.filter((c) => {
      const has = !!qrMap[c.id];
      if (status === "issued" && !has) return false;
      if (status === "missing" && has) return false;
      if (!q) return true;
      return (c.name || "").toLowerCase().includes(q) || (c.company_type || "").toLowerCase().includes(q);
    });
  }, [companies, qrMap, search, status]);

  const counts = useMemo(() => {
    const issued = companies.filter((c) => qrMap[c.id]).length;
    return { total: companies.length, issued, missing: companies.length - issued };
  }, [companies, qrMap]);

  if (!projectId) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        프로젝트를 먼저 선택하세요.
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap gap-2 items-center print:hidden">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Building2 className="h-6 w-6" /> 시공사 게시판 QR — {today}
        </h1>
        <div className="ml-auto flex gap-2">
          <Button onClick={issueAll} disabled={loading || !companies.length}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            오늘 일괄 발급
          </Button>
          <Button variant="outline" onClick={() => window.print()} disabled={!Object.keys(qrMap).length}>
            <Printer className="h-4 w-4 mr-2" />인쇄
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 print:hidden">
        <Card><CardContent className="pt-4 flex items-center justify-between">
          <div><div className="text-xs text-muted-foreground">전체 시공사</div><div className="text-2xl font-bold">{counts.total}</div></div>
          <Building2 className="h-6 w-6 text-primary" />
        </CardContent></Card>
        <Card><CardContent className="pt-4 flex items-center justify-between">
          <div><div className="text-xs text-muted-foreground">발급 완료</div><div className="text-2xl font-bold text-success">{counts.issued}</div></div>
          <CheckCircle2 className="h-6 w-6 text-success" />
        </CardContent></Card>
        <Card><CardContent className="pt-4 flex items-center justify-between">
          <div><div className="text-xs text-muted-foreground">미발급</div><div className="text-2xl font-bold text-destructive">{counts.missing}</div></div>
          <AlertTriangle className="h-6 w-6 text-destructive" />
        </CardContent></Card>
      </div>

      <Card className="print:hidden">
        <CardContent className="pt-4 flex gap-2 items-end flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-8" placeholder="시공사명·유형 검색" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
          </div>
          <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <TabsList>
              <TabsTrigger value="all">전체</TabsTrigger>
              <TabsTrigger value="issued">발급</TabsTrigger>
              <TabsTrigger value="missing">미발급</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
      </Card>

      <Card className="print:shadow-none print:border-0">
        <CardHeader className="print:hidden pb-2">
          <CardTitle className="text-sm">
            {filtered.length} / {companies.length} 시공사
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loadingList ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-72 w-full" />)}
            </div>
          ) : !companies.length ? (
            <div className="text-sm text-muted-foreground py-8 text-center">등록된 시공사가 없습니다.</div>
          ) : !filtered.length ? (
            <div className="text-sm text-muted-foreground py-8 text-center">필터에 해당하는 시공사가 없습니다.</div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 print:grid-cols-2">
              {filtered.map((c) => {
                const q = qrMap[c.id];
                const scanUrl = q ? `${baseUrl}/c/${q.qr_token}` : "";
                return (
                  <div
                    key={c.id}
                    className="border-2 rounded-lg p-4 flex flex-col items-center text-center break-inside-avoid bg-card"
                  >
                    <div className="text-xs text-muted-foreground">
                      {c.company_type || "시공사"} · {today}
                    </div>
                    <div className="text-lg font-bold mt-1">{c.name}</div>
                    <div className="my-3">
                      {q ? (
                        <QRCodeSVG value={scanUrl} size={200} level="H" />
                      ) : (
                        <div className="w-[200px] h-[200px] flex flex-col items-center justify-center bg-muted text-xs text-muted-foreground rounded gap-2">
                          <span>미발급</span>
                          <Button size="sm" variant="outline" className="print:hidden" onClick={() => issueOne(c.id)}>
                            발급
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="text-xs font-medium">출퇴근 QR — 스캔 후 본인 정보 입력</div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      만료: 익일 00:00 KST
                    </div>
                    {q && (
                      <Badge variant="outline" className="mt-2 print:hidden">
                        <CheckCircle2 className="h-3 w-3 mr-1 text-success" /> 발급 완료
                      </Badge>
                    )}
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
