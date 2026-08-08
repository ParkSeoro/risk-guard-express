import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useNavigateMobileHome } from "@/lib/mobileNav";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Search,
  UserPlus,
  Loader2,
  Ban,
  Unlock,
  LogIn,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";

import { useMobileAccess } from "@/hooks/useMobileAccess";
import { isManagerMobileRole } from "@/lib/mobileShell";
import { usePreview, usePreviewWriteBlock } from "@/contexts/PreviewContext";
import SuspendWorkerDialog from "@/components/workers/SuspendWorkerDialog";
import {
  formatSuspensionUntil,
  isWorkerCurrentlySuspended,
  suspensionKindLabel,
} from "@/lib/workerSuspension";

type TabKey = "roster" | "attendance";

type AttendanceRow = {
  worker_id: string | null;
  worker_name: string | null;
  company_name: string | null;
  company_id: string | null;
  entry_at: string | null;
  exit_at: string | null;
  attended: boolean | null;
  exited: boolean | null;
  tbm_at: string | null;
  attendance_source: string | null;
};

function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "—";
  }
}

/** Mobile workers — 명부 | 입퇴장 only (no daily/company QR tabs). */
export default function MobileWorkers() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const goMobileHome = useNavigateMobileHome();
  const { projectId, applyCompanyFilter, role, isMaster, accessibleCompanyIds } = useMobileAccess();
  const preview = usePreview();
  const blockWrite = usePreviewWriteBlock();
  const [workers, setWorkers] = useState<any[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [attLoading, setAttLoading] = useState(false);
  const [q, setQ] = useState("");
  const [attQ, setAttQ] = useState("");
  const [suspendTarget, setSuspendTarget] = useState<{ id: string; name: string } | null>(null);

  const initialTab = (searchParams.get("tab") === "attendance" ? "attendance" : "roster") as TabKey;
  const [tab, setTab] = useState<TabKey>(initialTab);

  const canSuspend = isManagerMobileRole(
    preview.isPreview ? preview.syntheticRole : role,
    preview.isPreview ? preview.syntheticRole === "master" : isMaster,
  );

  const loadRoster = async () => {
    if (!projectId) return;
    setLoading(true);
    let query: any = supabase
      .from("workers")
      .select(
        "*, site_entry_suspended_until, site_entry_suspension_reason, site_entry_suspension_kind",
      )
      .eq("project_id", projectId)
      .eq("is_active", true);
    query = applyCompanyFilter(query);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(200);
    if (error) toast.error("로드 실패: " + error.message);
    setWorkers(data || []);
    setLoading(false);
  };

  const loadAttendance = async () => {
    if (!projectId) return;
    setAttLoading(true);
    let query: any = supabase
      .from("v_worker_attendance_today" as any)
      .select(
        "worker_id, worker_name, company_name, company_id, entry_at, exit_at, attended, exited, tbm_at, attendance_source",
      )
      .eq("project_id", projectId)
      .eq("attended", true)
      .order("entry_at", { ascending: false })
      .limit(300);
    if (accessibleCompanyIds !== null) {
      query = query.in("company_id", accessibleCompanyIds);
    }
    const { data, error } = await query;
    if (error) toast.error("입퇴장 로드 실패: " + error.message);
    setAttendance(((data as any[]) || []) as AttendanceRow[]);
    setAttLoading(false);
  };

  useEffect(() => {
    loadRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  useEffect(() => {
    if (tab === "attendance") loadAttendance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, projectId, accessibleCompanyIds]);

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "attendance" || t === "roster") setTab(t);
  }, [searchParams]);

  const onTabChange = (v: string) => {
    const next = (v === "attendance" ? "attendance" : "roster") as TabKey;
    setTab(next);
    setSearchParams(next === "roster" ? {} : { tab: next }, { replace: true });
  };

  const filtered = workers.filter(
    (w) =>
      !q ||
      w.name?.includes(q) ||
      w.phone?.includes(q) ||
      w.company_name?.includes(q),
  );

  const filteredAtt = attendance.filter(
    (r) =>
      !attQ ||
      r.worker_name?.includes(attQ) ||
      r.company_name?.includes(attQ),
  );

  const onSiteCount = attendance.filter((r) => r.attended && !r.exited).length;

  const lift = async (w: any) => {
    if (blockWrite()) {
      toast.message("프리뷰 모드에서는 데이터를 변경할 수 없습니다.");
      return;
    }
    const { data, error } = await supabase.rpc("set_worker_site_entry_suspension" as any, {
      _worker_id: w.id,
      _kind: "lift",
      _reason: null,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    if ((data as any)?.error) {
      toast.error((data as any).error);
      return;
    }
    toast.success("출입 정지 해제");
    loadRoster();
  };

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button
          size="icon"
          variant="ghost"
          className="text-primary-foreground"
          onClick={() => goMobileHome()}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg flex-1">근로자 · 출입</div>
        {tab === "roster" && (
          <Button size="sm" variant="secondary" onClick={() => navigate("/worker/register")}>
            <UserPlus className="h-4 w-4 mr-1" /> 등록
          </Button>
        )}
      </header>

      <main className="p-4 space-y-3 max-w-md mx-auto">
        {!projectId && (
          <Card className="border-warning/40 bg-warning/5">
            <CardContent className="pt-3 pb-3 text-sm">프로젝트를 먼저 선택하세요.</CardContent>
          </Card>
        )}

        <Tabs value={tab} onValueChange={onTabChange}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="roster">명부</TabsTrigger>
            <TabsTrigger value="attendance">입퇴장 {onSiteCount > 0 ? `(${onSiteCount})` : ""}</TabsTrigger>
          </TabsList>

          <TabsContent value="roster" className="space-y-3 mt-3">
            <p className="text-xs text-muted-foreground">
              현장 근로자 명부입니다. QR 전용 포털은 종료되었고 계정 로그인이 필요합니다.
              관리자는 출입을 1일·3일·영구 정지할 수 있습니다. 출근은 앱 GPS로 합니다.
            </p>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="이름/전화/업체"
                className="pl-9 h-11"
              />
            </div>

            {loading && (
              <div className="text-center py-8">
                <Loader2 className="h-5 w-5 animate-spin inline" />
              </div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="text-center text-muted-foreground py-12 text-sm">근로자가 없습니다</div>
            )}

            {filtered.map((w) => {
              const suspended = isWorkerCurrentlySuspended(w);
              return (
                <Card key={w.id} className={suspended ? "border-destructive/40" : undefined}>
                  <CardContent className="pt-3 pb-3 space-y-2">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{w.name}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {w.company_name || "—"} · {w.phone}
                        </div>
                        {w.education_confirmed_at && (
                          <Badge variant="secondary" className="text-[10px] mt-1">
                            교육완료
                          </Badge>
                        )}
                        {suspended && (
                          <Badge variant="destructive" className="text-[10px] mt-1 ml-1">
                            출입정지 · {suspensionKindLabel(w.site_entry_suspension_kind)}
                          </Badge>
                        )}
                      </div>
                    </div>
                    {suspended && (
                      <div className="text-[11px] text-destructive/90">
                        {formatSuspensionUntil(
                          w.site_entry_suspended_until,
                          w.site_entry_suspension_kind,
                        )}
                        {w.site_entry_suspension_reason
                          ? ` · ${w.site_entry_suspension_reason}`
                          : ""}
                      </div>
                    )}
                    {canSuspend && (
                      <div className="flex gap-2">
                        {suspended ? (
                          <Button size="sm" variant="secondary" className="flex-1" onClick={() => lift(w)}>
                            <Unlock className="h-3.5 w-3.5 mr-1" /> 정지 해제
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="destructive"
                            className="flex-1"
                            onClick={() => setSuspendTarget({ id: w.id, name: w.name })}
                          >
                            <Ban className="h-3.5 w-3.5 mr-1" /> 출입 정지
                          </Button>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </TabsContent>

          <TabsContent value="attendance" className="space-y-3 mt-3">
            <p className="text-xs text-muted-foreground">
              오늘 입퇴장 현황입니다. 현장 인원 {onSiteCount}명.
            </p>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={attQ}
                onChange={(e) => setAttQ(e.target.value)}
                placeholder="이름/업체"
                className="pl-9 h-11"
              />
            </div>
            {attLoading && (
              <div className="text-center py-8">
                <Loader2 className="h-5 w-5 animate-spin inline" />
              </div>
            )}
            {!attLoading && filteredAtt.length === 0 && (
              <div className="text-center text-muted-foreground py-12 text-sm">
                오늘 출입 기록이 없습니다
              </div>
            )}
            {filteredAtt.map((r) => {
              const inside = !!r.attended && !r.exited;
              return (
                <Card key={`${r.worker_id}-${r.entry_at || r.tbm_at || "x"}`}>
                  <CardContent className="pt-3 pb-3 space-y-1">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{r.worker_name || "—"}</div>
                        <div className="text-xs text-muted-foreground truncate">
                          {r.company_name || "—"}
                        </div>
                      </div>
                      <Badge variant={inside ? "default" : "secondary"}>
                        {inside ? (
                          <><LogIn className="h-3 w-3 mr-1" />현장</>
                        ) : (
                          <><LogOut className="h-3 w-3 mr-1" />퇴장</>
                        )}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      입장 {fmtTime(r.entry_at)} · 퇴장 {fmtTime(r.exit_at)}
                      {r.tbm_at ? ` · TBM ${fmtTime(r.tbm_at)}` : ""}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            <Button variant="outline" className="w-full" onClick={loadAttendance} disabled={attLoading}>
              새로고침
            </Button>
          </TabsContent>
        </Tabs>
      </main>

      <SuspendWorkerDialog
        open={!!suspendTarget}
        onOpenChange={(v) => !v && setSuspendTarget(null)}
        worker={suspendTarget}
        onDone={loadRoster}
      />

    </div>
  );
}
