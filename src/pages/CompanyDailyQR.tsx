import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { QRCodeSVG } from "qrcode.react";
import { Building2, Printer, RefreshCw } from "lucide-react";
import { toast } from "sonner";

/**
 * 시공사(회사)별 일일 게시판 QR — 관리자가 매일 출력해 게시판에 부착.
 * 근로자는 게시판 QR을 폰으로 스캔해 본인 이름/연락처를 입력하면 출입 기록이 생성된다.
 */
export default function CompanyDailyQR() {
  const [projectId] = useState<string>(() => localStorage.getItem("currentProjectId") || "");
  const [companies, setCompanies] = useState<any[]>([]);
  const [qrMap, setQrMap] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const baseUrl = window.location.origin;

  useEffect(() => {
    if (!projectId) return;
    (async () => {
      const { data } = await supabase
        .from("companies")
        .select("id,name,company_type")
        .eq("project_id", projectId)
        .eq("is_deleted", false)
        .order("name");
      setCompanies(data || []);
    })();
  }, [projectId]);

  useEffect(() => {
    if (!companies.length) return;
    (async () => {
      const ids = companies.map((c) => c.id);
      const { data } = await supabase
        .from("company_daily_qr")
        .select("company_id,qr_token,expires_at,work_date")
        .in("company_id", ids)
        .eq("work_date", today);
      const map: Record<string, any> = {};
      (data || []).forEach((q: any) => { map[q.company_id] = q; });
      setQrMap(map);
    })();
  }, [companies, today]);

  const issueAll = async () => {
    if (!companies.length) return;
    setLoading(true);
    let ok = 0, fail = 0, lastErr = "";
    for (const c of companies) {
      const { data, error } = await supabase.rpc("issue_company_daily_qr", {
        _company_id: c.id,
      });
      if (error) { fail++; lastErr = error.message; continue; }
      if ((data as any)?.error) { fail++; lastErr = (data as any).error; continue; }
      ok++;
    }
    setLoading(false);
    fail
      ? toast.error(`${ok}건 발급, ${fail}건 실패: ${lastErr}`)
      : toast.success(`${ok}건 발급 완료`);

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
        <Button onClick={issueAll} disabled={loading || !companies.length}>
          <RefreshCw className="h-4 w-4 mr-2" />
          오늘({today}) 회사 QR 일괄 발급
        </Button>
        <Button variant="outline" onClick={() => window.print()} disabled={!Object.keys(qrMap).length}>
          <Printer className="h-4 w-4 mr-2" />인쇄
        </Button>
        <Badge variant="secondary" className="ml-auto">
          발급 {Object.keys(qrMap).length} / 전체 {companies.length}
        </Badge>
      </div>

      <Card className="print:shadow-none print:border-0">
        <CardHeader className="print:hidden">
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" /> {today} 시공사 게시판 QR
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!companies.length ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              등록된 시공사가 없습니다.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 print:grid-cols-2">
              {companies.map((c) => {
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
                        <div className="w-[200px] h-[200px] flex items-center justify-center bg-muted text-xs text-muted-foreground rounded">
                          미발급
                        </div>
                      )}
                    </div>
                    <div className="text-xs font-medium">출퇴근 QR — 스캔 후 본인 정보 입력</div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      만료: 익일 00:00 KST
                    </div>
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
