/**
 * Mobile permit document viewer (read-only).
 * Approvals go through the unified inbox: /app/worker/approvals
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNavigateMobileHome } from "@/lib/mobileNav";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileCheck2, Loader2, Inbox } from "lucide-react";
import { toast } from "sonner";
import {
  resolvePermitWorkDate,
  canViewPermitInList,
} from "@/lib/permitWorkDate";

const STATUS_BADGE: Record<string, string> = {
  대기: "bg-warning/20 text-warning",
  검토중: "bg-primary/20 text-primary",
  승인: "bg-success/20 text-success",
  반려: "bg-destructive/20 text-destructive",
  작성중: "bg-muted text-muted-foreground",
  결재중: "bg-primary/20 text-primary",
};

const getForm = (p: any) => (p?.form_data && typeof p.form_data === "object" ? p.form_data : {});
const permitTitle = (p: any) =>
  p?.work_name || getForm(p).work_name || p?.work_description || "(제목 없음)";
const permitLocation = (p: any) =>
  p?.location || p?.work_location || getForm(p).work_location || "-";
const permitCompany = (p: any) =>
  p?.contractor_company || getForm(p).contractor_company || getForm(p).applicant_company || "-";
const permitPersonnel = (p: any) => p?.personnel_count || getForm(p).personnel_count || 0;

export default function MobilePermits() {
  const navigate = useNavigate();
  const goMobileHome = useNavigateMobileHome();
  const { profile, isAdmin } = useAuth();
  const { projectId, applyCompanyFilter, isProjectAdmin } = useMobileAccess();
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<any | null>(null);

  const load = async () => {
    if (!projectId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let q: any = supabase
      .from("work_permits" as any)
      .select("*")
      .eq("project_id", projectId)
      .eq("is_deleted", false);
    q = applyCompanyFilter(q);
    const userId = profile?.user_id || "";
    const [{ data, error }, { data: myApprovals }] = await Promise.all([
      q.order("permit_date", { ascending: false }).limit(100),
      userId
        ? supabase
            .from("approvals")
            .select("entity_id, id, status")
            .eq("project_id", projectId)
            .eq("entity_type", "work_permit")
            .eq("approver_id", userId)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    if (error) toast.error("로드 실패: " + error.message);
    const involved = new Set(
      ((myApprovals as any[]) || [])
        .map((a) => a.entity_id)
        .filter((id): id is string => !!id),
    );
    const rows = ((data as any[]) || []).filter((p) =>
      canViewPermitInList(p, {
        userId,
        isPermitAdmin: !!isProjectAdmin || !!isAdmin,
        involvedPermitIds: involved,
      }),
    );
    setList(rows);
    setLoading(false);
  };
  useEffect(() => {
    load(); /* eslint-disable-next-line */
  }, [projectId, profile?.user_id]);

  return (
    <div className="min-h-screen bg-muted/30 pb-24" data-testid="mobile-permits-viewer">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button
          size="icon"
          variant="ghost"
          className="text-primary-foreground"
          onClick={() => (active ? setActive(null) : goMobileHome())}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg flex-1">작업허가서</div>
        <Badge variant="secondary">{list.length}</Badge>
      </header>

      <main className="p-4 space-y-3 max-w-md mx-auto">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="pt-3 pb-3 text-xs space-y-2">
            <p>모바일에서는 승인된·진행 중 허가서를 조회합니다. 승인·반려는 통합 결재함에서 합니다.</p>
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={() => navigate("/app/worker/approvals")}
            >
              <Inbox className="h-4 w-4 mr-1" /> 결재함 열기
            </Button>
          </CardContent>
        </Card>

        {!projectId && (
          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="pt-3 pb-3 text-sm">프로젝트를 먼저 선택하세요.</CardContent>
          </Card>
        )}
        {loading && (
          <div className="text-center text-muted-foreground py-8">
            <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
            로딩…
          </div>
        )}

        {!active && !loading && projectId && list.length === 0 && (
          <Card>
            <CardContent className="pt-6 text-center text-sm text-muted-foreground">
              조회 가능한 작업허가서가 없습니다.
            </CardContent>
          </Card>
        )}

        {!active &&
          list.map((p) => (
            <Card
              key={p.id}
              className="active:scale-[0.99] transition cursor-pointer"
              onClick={() => setActive(p)}
            >
              <CardContent className="pt-4">
                <div className="flex items-start gap-2">
                  <FileCheck2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{permitTitle(p)}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {p.permit_type} · {permitLocation(p)} · {permitCompany(p)}
                    </div>
                    <div className="text-xs mt-1">
                      {resolvePermitWorkDate(p) || p.permit_date} · 인원 {permitPersonnel(p)}명
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded ${STATUS_BADGE[p.status] || "bg-muted"}`}
                  >
                    {p.status}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}

        {active && (
          <Card>
            <CardContent className="pt-4 space-y-2">
              <div className="font-bold text-base">{permitTitle(active)}</div>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <div>유형: {active.permit_type}</div>
                <div>상태: {active.status}</div>
                <div>일자: {resolvePermitWorkDate(active) || active.permit_date}</div>
                <div>장소: {permitLocation(active)}</div>
                <div>업체: {permitCompany(active)}</div>
                <div>인원: {permitPersonnel(active)}명</div>
              </div>
              {active.work_description && (
                <div className="text-sm bg-muted/40 rounded p-2 mt-2 whitespace-pre-wrap">
                  {active.work_description}
                </div>
              )}
              <Button
                className="w-full mt-2"
                variant="secondary"
                onClick={() => navigate("/app/worker/approvals")}
              >
                이 문서 결재는 결재함에서
              </Button>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
