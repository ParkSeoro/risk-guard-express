/**
 * Mobile permit document viewer (read-only).
 * Approvals go through the unified inbox: /app/worker/approvals
 * Deep link: /app/worker/permits?id=<permitId>
 */
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useNavigateMobileHome } from "@/lib/mobileNav";
import PermitReadOnlyPreview from "@/components/permits/PermitReadOnlyPreview";
import { resolvePermitViewerBackPath } from "@/lib/permitViewerNav";
import { hydratePermitPreview } from "@/lib/permitPreviewHydrate";
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
  todayKst,
  permitValidityKind,
  shouldShowPermitValidityBadge,
} from "@/lib/permitWorkDate";
import type { PermitFormData, PermitSignatures } from "@/components/permits/DigPermitForm";
import type { PermitAiBriefing } from "@/lib/permitBriefing";
import { isPureWorkerUser } from "@/components/AuthGuard";

const STATUS_BADGE: Record<string, string> = {
  대기: "bg-warning/20 text-warning",
  검토중: "bg-primary/20 text-primary",
  승인: "bg-success/20 text-success",
  승인완료: "bg-success/20 text-success",
  발행완료: "bg-success/20 text-success",
  반려: "bg-destructive/20 text-destructive",
  작성중: "bg-muted text-muted-foreground",
  결재중: "bg-primary/20 text-primary",
  종료대기: "bg-amber-500/20 text-amber-700",
  종료완료: "bg-muted text-muted-foreground",
  종료: "bg-success/20 text-success",
};

function permitStatusLabel(status?: string | null) {
  if (status === "종료완료" || status === "CLOSED" || status === "마감") return "종료 완료";
  if (status === "종료대기" || status === "CLOSURE_PENDING") return "작업 완료 확인 대기";
  if (status === "승인" || status === "승인완료" || status === "발행완료" || status === "approved") {
    return "발행 완료";
  }
  if (status === "결재중" || status === "결재진행") return "결재 진행중";
  return status || "-";
}

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
  const [searchParams, setSearchParams] = useSearchParams();
  const deepId = searchParams.get("id");
  const fromParam = searchParams.get("from");
  const goMobileHome = useNavigateMobileHome();
  const { profile, isAdmin, roles } = useAuth();
  const { projectId, applyCompanyFilter, isProjectAdmin } = useMobileAccess();
  const pureWorker = isPureWorkerUser(roles || []);
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<any | null>(null);
  const [formData, setFormData] = useState<PermitFormData>({});
  const [signatures, setSignatures] = useState<PermitSignatures>({});
  const [briefing, setBriefing] = useState<PermitAiBriefing | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

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
    // Feature ACL + upstream company filter — SM is not project-wide company scope.
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

  const openPermit = async (p: any) => {
    setDetailLoading(true);
    setActive(p);
    try {
      const hydrated = await hydratePermitPreview(p);
      setFormData(hydrated.formData);
      setSignatures(hydrated.signatures);
      setBriefing(hydrated.briefing);
    } catch (e: any) {
      toast.error(e?.message || "허가서 상세를 불러오지 못했습니다.");
    }
    setDetailLoading(false);
  };

  useEffect(() => {
    if (!deepId) return;
    const fromList = list.find((p) => p.id === deepId);
    if (fromList) {
      openPermit(fromList);
      return;
    }
    if (!projectId && list.length === 0 && loading) return;
    (async () => {
      const { data, error } = await supabase
        .from("work_permits" as any)
        .select("*")
        .eq("id", deepId)
        .maybeSingle();
      if (error || !data) {
        toast.error("허가서를 찾을 수 없습니다.");
        return;
      }
      openPermit(data);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepId, list, projectId, loading]);

  const closeDetail = () => {
    setActive(null);
    setSignatures({});
    setFormData({});
    setBriefing(null);
    if (deepId) {
      const next = new URLSearchParams(searchParams);
      next.delete("id");
      setSearchParams(next, { replace: true });
    }
  };

  const onBack = () => {
    const backTo = resolvePermitViewerBackPath(fromParam);
    if (backTo) {
      navigate(backTo);
      return;
    }
    if (active) {
      closeDetail();
      return;
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      navigate(-1);
      return;
    }
    goMobileHome();
  };

  return (
    <div className="min-h-screen bg-muted/30 pb-24" data-testid="mobile-permits-viewer">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button
          size="icon"
          variant="ghost"
          className="text-primary-foreground"
          onClick={onBack}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg flex-1">작업허가서</div>
        <Badge variant="secondary">{active ? 1 : list.length}</Badge>
      </header>

      <main className="p-4 space-y-3 max-w-md mx-auto">
        {!active && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="pt-3 pb-3 text-xs space-y-2">
              <p>
                {pureWorker
                  ? "승인·진행 중 허가서와 AI 핵심 요약을 조회합니다. 작성·결재는 PC/관리자 화면에서 합니다."
                  : "모바일에서는 승인된·진행 중 허가서를 조회합니다. 승인·반려는 통합 결재함에서 합니다."}
              </p>
              {!pureWorker && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  onClick={() => navigate("/app/worker/approvals")}
                >
                  <Inbox className="h-4 w-4 mr-1" /> 결재함 열기
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {!projectId && !active && (
          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="pt-3 pb-3 text-sm">프로젝트를 먼저 선택하세요.</CardContent>
          </Card>
        )}
        {loading && !active && (
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
              onClick={() => {
                setSearchParams({ id: p.id });
                openPermit(p);
              }}
            >
              <CardContent className="pt-4">
                <div className="flex items-start gap-2">
                  <FileCheck2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{permitTitle(p)}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {p.permit_type} · {permitLocation(p)} · {permitCompany(p)}
                    </div>
                    <div className="text-xs mt-1 flex flex-wrap items-center gap-1">
                      <span>{resolvePermitWorkDate(p) || p.permit_date} · 인원 {permitPersonnel(p)}명</span>
                      {(() => {
                        const workDate = resolvePermitWorkDate(p);
                        const validity = shouldShowPermitValidityBadge(p.status)
                          ? permitValidityKind(workDate, todayKst())
                          : null;
                        if (validity === "expired") {
                          return (
                            <Badge variant="outline" className="text-[10px] text-destructive border-destructive/40">
                              만료
                            </Badge>
                          );
                        }
                        if (validity === "today") {
                          return (
                            <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-500/40">
                              오늘 유효
                            </Badge>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded shrink-0 ${STATUS_BADGE[p.status] || "bg-muted"}`}
                  >
                    {permitStatusLabel(p.status)}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))}

        {active && (
          <div className="space-y-3">
            <Card>
              <CardContent className="pt-4 space-y-2">
                <div className="font-bold text-base">{permitTitle(active)}</div>
                <div className="text-xs text-muted-foreground space-y-0.5">
                  <div>상태: {permitStatusLabel(active.status)}</div>
                  <div>일자: {resolvePermitWorkDate(active) || active.permit_date}</div>
                  <div>장소: {permitLocation(active)}</div>
                  <div>업체: {permitCompany(active)}</div>
                </div>
                {!pureWorker && (
                  <Button
                    className="w-full"
                    variant="secondary"
                    onClick={() => navigate("/app/worker/approvals")}
                  >
                    결재함으로
                  </Button>
                )}
              </CardContent>
            </Card>

            <PermitReadOnlyPreview
              formData={formData}
              signatures={signatures}
              briefing={briefing}
              permitType={active.permit_type}
              permitKinds={active.permit_kinds}
              loading={detailLoading}
            />
          </div>
        )}
      </main>
    </div>
  );
}
