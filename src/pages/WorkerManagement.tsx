import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { QRCodeSVG } from "qrcode.react";
import { HardHat, QrCode, Trash2, ExternalLink, Settings2, AlertTriangle, FileSpreadsheet, Search, Ban, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import WorkerAttendance from "./WorkerAttendance";
import WorkerBulkImportDialog from "@/components/workers/WorkerBulkImportDialog";
import SuspendWorkerDialog from "@/components/workers/SuspendWorkerDialog";
import {
  formatSuspensionUntil,
  isWorkerCurrentlySuspended,
  suspensionKindLabel,
} from "@/lib/workerSuspension";
import { isManagementJobType, isRosterManagementRow } from "@/lib/jobCategories";
import { ADMIN_PROJECT_ROLES } from "@/lib/permissions";
import { digitsOnlyPhone } from "@/lib/workerAuth";
import { isClaimableOrphanWorker } from "@/lib/companyLabel";
import { companyDocScopeMode } from "@/lib/companyDocScope";
import { useAuditLog } from "@/hooks/useAuditLog";
import { useGlobalProjectAccessOptional } from "@/components/AppLayout";

const RESTRICTED_ROLES = new Set(["site_manager", "supervisor", "site_supervisor", "worker"]);
const ADMIN_ROLE_SET = new Set<string>(ADMIN_PROJECT_ROLES);

/** 등록 명부 보기: 현장 작업자(기본) / 관리 / 전체 */
type RosterFilter = "field" | "management" | "all";

export default function WorkerManagement() {
  const access = useGlobalProjectAccessOptional();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const resolveTab = (v: string | null) => (v === "attendance" ? "attendance" : "register");
  const [tab, setTab] = useState<string>(resolveTab(tabParam));

  // URL → state 동기화. 레거시 일일/게시판 QR 탭은 앱 출근으로 대체 → 등록 탭으로 정리.
  useEffect(() => {
    if (tabParam === "daily-qr" || tabParam === "company-qr") {
      const p = new URLSearchParams(searchParams);
      p.delete("tab");
      setSearchParams(p, { replace: true });
      setTab("register");
      toast.message("일일·게시판 QR은 앱 출근으로 대체되었습니다", {
        description: "등록 QR로 계정 가입 후 근로자 앱에서 출근하세요.",
        duration: 5000,
      });
      return;
    }
    setTab(resolveTab(tabParam));
  }, [tabParam, searchParams, setSearchParams]);

  const [projectId, setProjectId] = useState<string>(() => localStorage.getItem("currentProjectId") || "");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [companyId, setCompanyId] = useState<string>("");
  const [companyLocked, setCompanyLocked] = useState(false);
  const [workers, setWorkers] = useState<any[]>([]);
  /** phone digits → project admin role_new (from project_members + profiles) */
  const [adminPhoneRoles, setAdminPhoneRoles] = useState<Map<string, string>>(new Map());
  /** phone digits → profiles.account_status (등록대기 표시) */
  const [accountStatusByPhone, setAccountStatusByPhone] = useState<Map<string, string>>(new Map());
  const [showQr, setShowQr] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [rosterFilter, setRosterFilter] = useState<RosterFilter>("field");
  const [suspendTarget, setSuspendTarget] = useState<{ id: string; name: string } | null>(null);
  const { log } = useAuditLog();
  const baseUrl = window.location.origin;
  const registerUrl = projectId && companyId
    ? `${baseUrl}/worker/register?project=${projectId}&company=${companyId}`
    : "";

  const rowMeta = useMemo(() => {
    const map = new Map<string, { isMgr: boolean; byJob: boolean; byPerm: boolean; permRole?: string }>();
    for (const w of workers) {
      const digits = digitsOnlyPhone(w.phone);
      const permRole = digits ? adminPhoneRoles.get(digits) : undefined;
      const byJob = isManagementJobType(w.job_type);
      const byPerm = !!permRole;
      map.set(w.id, {
        isMgr: isRosterManagementRow({ jobType: w.job_type, hasAdminPermission: byPerm }),
        byJob,
        byPerm,
        permRole,
      });
    }
    return map;
  }, [workers, adminPhoneRoles]);

  const rosterCounts = useMemo(() => {
    let field = 0;
    let management = 0;
    for (const w of workers) {
      if (rowMeta.get(w.id)?.isMgr) management += 1;
      else field += 1;
    }
    return { field, management, all: workers.length };
  }, [workers, rowMeta]);

  const filteredWorkers = useMemo(() => {
    let list = workers;
    if (rosterFilter === "field") {
      list = list.filter((w) => !rowMeta.get(w.id)?.isMgr);
    } else if (rosterFilter === "management") {
      list = list.filter((w) => rowMeta.get(w.id)?.isMgr);
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (w) =>
        (w.name || "").toLowerCase().includes(q) ||
        (w.phone || "").toLowerCase().includes(q) ||
        (w.company_name || "").toLowerCase().includes(q) ||
        (w.job_type || "").toLowerCase().includes(q),
    );
  }, [workers, search, rosterFilter, rowMeta]);

  useEffect(() => {
    supabase.from("projects").select("id,name").eq('is_deleted', false).then(({ data }) => setProjects(data || []));
  }, []);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem("currentProjectId", projectId);
    setCompanyId("");
    setCompanyLocked(false);
    import("@/lib/projectCompanies").then(({ fetchProjectCompanies }) =>
      fetchProjectCompanies(projectId).then((rows) => setCompanies(rows.map(c => ({ id: c.id, name: c.name }))))
    );
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
    setLoading(true);
    let q: any = supabase
      .from("workers")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .order("created_at", { ascending: false });
    // Include company_id NULL orphans; filter by company label so other firms stay hidden.
    if (access?.applyCompanyFilter) q = access.applyCompanyFilter(q, { includeOrphans: true });
    const [{ data, error }, membersRes] = await Promise.all([
      q,
      supabase
        .from("project_members")
        .select("user_id, role_new")
        .eq("project_id", projectId),
    ]);

    const adminMap = new Map<string, string>();
    const members = (membersRes.data || []).filter(
      (m: any) => m.role_new && ADMIN_ROLE_SET.has(String(m.role_new)),
    );
    if (members.length > 0) {
      const userIds = members.map((m: any) => m.user_id).filter(Boolean);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, phone")
        .in("user_id", userIds);
      const roleByUser = new Map(members.map((m: any) => [m.user_id, String(m.role_new)]));
      for (const p of profiles || []) {
        const digits = digitsOnlyPhone((p as any).phone);
        const role = roleByUser.get((p as any).user_id);
        if (digits && role) adminMap.set(digits, role);
      }
    }
    setAdminPhoneRoles(adminMap);

    const workerList = data || [];
    const phoneDigits = [
      ...new Set(
        workerList
          .map((w: any) => digitsOnlyPhone(w.phone))
          .filter((d: string) => d.length >= 9),
      ),
    ];
    const statusMap = new Map<string, string>();
    if (phoneDigits.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("phone, account_status")
        .in("phone", phoneDigits);
      // also try raw phones with hyphens from workers
      for (const p of profs || []) {
        const d = digitsOnlyPhone((p as any).phone);
        if (d) statusMap.set(d, String((p as any).account_status || "active"));
      }
      // Fallback: fetch more broadly if phone stored with hyphens
      if (statusMap.size < phoneDigits.length) {
        const { data: allProfs } = await supabase
          .from("profiles")
          .select("phone, account_status")
          .limit(2000);
        for (const p of allProfs || []) {
          const d = digitsOnlyPhone((p as any).phone);
          if (d && phoneDigits.includes(d)) {
            statusMap.set(d, String((p as any).account_status || "active"));
          }
        }
      }
    }
    setAccountStatusByPhone(statusMap);

    setLoading(false);
    if (error) { toast.error(error.message); return; }

    // Full-project roles: keep query result. Own/tree scope: drop other firms' orphans.
    // Label match is company-agnostic (any firm name, not a hardcoded company).
    const scopeMode = companyDocScopeMode({
      role: access?.userRole as any,
      companyType: access?.userCompanyType,
      isMaster: access?.isMaster,
    });
    if (scopeMode === "all") {
      setWorkers(workerList);
      return;
    }
    const ownCompanyId = companyId || access?.userCompanyId || null;
    let ownName =
      companies.find((c) => c.id === ownCompanyId)?.name
      || workerList.find((w: any) => w.company_id === ownCompanyId)?.company_name
      || null;
    if (!ownName && ownCompanyId) {
      const { data: cRow } = await supabase
        .from("companies")
        .select("name")
        .eq("id", ownCompanyId)
        .maybeSingle();
      ownName = (cRow as { name?: string } | null)?.name || null;
    }
    setWorkers(
      workerList.filter((w: any) => isClaimableOrphanWorker(w, ownCompanyId, ownName)),
    );
  };

  const remove = async (w: any) => {
    const reason = window.prompt(`[${w.name}] 비활성 처리 사유를 입력하세요.\n(나중에 재활성 가능합니다)`, "");
    if (reason === null) return;
    if (!reason.trim()) { toast.error("사유는 필수입니다"); return; }
    const { error } = await supabase
      .from("workers")
      .update({ is_active: false })
      .eq("id", w.id);
    if (error) { toast.error(error.message); return; }
    await log("soft_delete", "workers", w.id, projectId, { reason: reason.trim(), label: w.name });
    setWorkers(prev => prev.filter(x => x.id !== w.id));
    toast.success("비활성 처리됨");
  };

  const liftSuspension = async (w: any) => {
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
    await log("site_entry_unsuspend", "workers", w.id, projectId, { label: w.name });
    toast.success("출입 정지 해제");
    load();
  };

  const onTabChange = (v: string) => {
    setTab(v);
    const p = new URLSearchParams(searchParams);
    if (v === "register") p.delete("tab"); else p.set("tab", v);
    setSearchParams(p, { replace: true });
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <HardHat className="h-6 w-6" /> 근로자 관리
      </h1>

      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList>
          <TabsTrigger value="register" className="gap-2">
            등록 정보 {workers.length > 0 && <Badge variant="secondary">{workers.length}</Badge>}
          </TabsTrigger>
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
                <Button
                  onClick={() => {
                    if (!companyId) {
                      toast.error("등록 QR에는 소속사 선택이 필수입니다");
                      return;
                    }
                    setShowQr(true);
                  }}
                >
                  <QrCode className="h-4 w-4 mr-2" />등록 QR 표시
                </Button>
                <Button variant="secondary" onClick={() => setShowBulk(true)}><FileSpreadsheet className="h-4 w-4 mr-2" />엑셀 일괄등록</Button>
                <Link to="/workers/legal-mapping"><Button variant="outline"><Settings2 className="h-4 w-4 mr-2" />법정 교육 매핑</Button></Link>
              </>
            )}
          </div>

          {projectId && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap space-y-0">
                <div className="space-y-1.5 min-w-0">
                  <CardTitle>
                    등록 명부 ({filteredWorkers.length}
                    {search || rosterFilter !== "all" ? ` / ${workers.length}` : ""}명)
                  </CardTitle>
                  <div className="flex flex-wrap gap-1.5">
                    {(
                      [
                        { id: "field" as const, label: "현장 작업자", count: rosterCounts.field },
                        { id: "management" as const, label: "관리", count: rosterCounts.management },
                        { id: "all" as const, label: "전체", count: rosterCounts.all },
                      ] as const
                    ).map((opt) => (
                      <Button
                        key={opt.id}
                        type="button"
                        size="sm"
                        variant={rosterFilter === opt.id ? "default" : "outline"}
                        className="h-8 text-xs"
                        onClick={() => setRosterFilter(opt.id)}
                        data-testid={`roster-filter-${opt.id}`}
                      >
                        {opt.label}
                        <Badge
                          variant={rosterFilter === opt.id ? "secondary" : "outline"}
                          className="ml-1.5 text-[10px] px-1.5"
                        >
                          {opt.count}
                        </Badge>
                      </Button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    관리 = 직종(안전관리자·관리감독자) 또는 설정에서 준 프로젝트 관리 권한 (전화 매칭)
                  </p>
                </div>
                <div className="relative w-64 shrink-0">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    className="pl-8 h-9"
                    placeholder="이름·전화·소속사·직종 검색"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="space-y-2">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : workers.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-12 text-center space-y-3">
                    <HardHat className="h-10 w-10 mx-auto text-muted-foreground/50" />
                    <div>아직 등록된 근로자가 없습니다.<br />아래 방법 중 하나로 등록하세요.</div>
                    <div className="flex gap-2 justify-center pt-2">
                      <Button size="sm" onClick={() => setShowQr(true)}><QrCode className="h-4 w-4 mr-2" />등록 QR</Button>
                      <Button size="sm" variant="secondary" onClick={() => setShowBulk(true)}><FileSpreadsheet className="h-4 w-4 mr-2" />엑셀 일괄등록</Button>
                    </div>
                  </div>
                ) : filteredWorkers.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-8 text-center space-y-2">
                    <div>
                      {search
                        ? "검색 결과가 없습니다."
                        : rosterFilter === "management"
                          ? "관리로 분류된 인원이 없습니다. (관리 직종 또는 프로젝트 관리 권한)"
                          : "이 보기에 해당하는 인원이 없습니다."}
                    </div>
                    <div className="flex gap-2 justify-center flex-wrap">
                      {search && (
                        <Button variant="link" className="p-0 h-auto" onClick={() => setSearch("")}>
                          검색 초기화
                        </Button>
                      )}
                      {rosterFilter !== "all" && (
                        <Button variant="link" className="p-0 h-auto" onClick={() => setRosterFilter("all")}>
                          전체 보기
                        </Button>
                      )}
                    </div>
                  </div>
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
                          <th className="text-left p-2">출입</th>
                          <th className="p-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredWorkers.map(w => {
                          const suspended = isWorkerCurrentlySuspended(w);
                          const meta = rowMeta.get(w.id);
                          return (
                          <tr key={w.id} className="border-b hover:bg-muted/40">
                            <td className="p-2 font-medium">
                              <Link to={`/workers/${w.id}`} className="text-primary hover:underline">{w.name}</Link>
                            </td>
                            <td className="p-2">{w.phone}</td>
                            <td className="p-2">{w.company_name}</td>
                            <td className="p-2 text-xs">
                              <div className="flex flex-wrap items-center gap-1">
                                <span>{w.job_type || "-"}</span>
                                {meta?.byJob && (
                                  <Badge variant="outline" className="text-[10px] px-1.5">
                                    관리직종
                                  </Badge>
                                )}
                                {meta?.byPerm && (
                                  <Badge variant="secondary" className="text-[10px] px-1.5">
                                    권한
                                  </Badge>
                                )}
                              </div>
                            </td>
                            <td className="p-2">{w.education_confirmed_at ? <Badge className="bg-success">확인</Badge> : <Badge variant="secondary">미확인</Badge>}</td>
                            <td className="p-2">
                              {w.requires_daily_health_log && <Badge variant="outline" className="gap-1 text-warning border-warning"><AlertTriangle className="h-3 w-3" />일일일지</Badge>}
                            </td>
                            <td className="p-2">
                              {(() => {
                                const st = accountStatusByPhone.get(digitsOnlyPhone(w.phone));
                                if (st === "pending") {
                                  return <Badge variant="outline" className="text-amber-700 border-amber-500">등록대기</Badge>;
                                }
                                if (w.is_active) return <Badge>활성</Badge>;
                                return <Badge variant="outline">비활성</Badge>;
                              })()}
                            </td>
                            <td className="p-2">
                              {suspended ? (
                                <div className="space-y-0.5">
                                  <Badge variant="destructive">
                                    정지 · {suspensionKindLabel(w.site_entry_suspension_kind)}
                                  </Badge>
                                  <div className="text-[10px] text-muted-foreground max-w-[160px] truncate" title={w.site_entry_suspension_reason || ""}>
                                    {formatSuspensionUntil(w.site_entry_suspended_until, w.site_entry_suspension_kind)}
                                    {w.site_entry_suspension_reason ? ` · ${w.site_entry_suspension_reason}` : ""}
                                  </div>
                                </div>
                              ) : (
                                <Badge variant="outline">정상</Badge>
                              )}
                            </td>
                            <td className="p-2 flex gap-1 items-center">
                              <Link to={`/workers/${w.id}`}><Button size="icon" variant="ghost"><ExternalLink className="h-4 w-4" /></Button></Link>
                              {suspended ? (
                                <Button size="icon" variant="ghost" title="출입 정지 해제" onClick={() => liftSuspension(w)}>
                                  <Unlock className="h-4 w-4" />
                                </Button>
                              ) : (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  title="현장 출입 정지 (1일/3일/영구)"
                                  onClick={() => setSuspendTarget({ id: w.id, name: w.name })}
                                >
                                  <Ban className="h-4 w-4 text-destructive" />
                                </Button>
                              )}
                              <Button size="icon" variant="ghost" onClick={() => remove(w)} title="비활성 처리(사유 필수)"><Trash2 className="h-4 w-4" /></Button>
                            </td>
                          </tr>
                          );
                        })}
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
          <DialogHeader><DialogTitle>근로자 등록 QR (계정 가입)</DialogTitle></DialogHeader>
          <div className="flex flex-col items-center gap-3 p-4">
            <div className="w-full">
              <Select
                value={companyId || ""}
                onValueChange={(v) => setCompanyId(v)}
                disabled={companyLocked}
              >
                <SelectTrigger><SelectValue placeholder="소속사 선택 (필수)" /></SelectTrigger>
                <SelectContent>
                  {companies.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <div className="text-[11px] text-muted-foreground mt-1">
                {companyLocked
                  ? "협력사 권한이라 본인 소속사로 고정됩니다."
                  : "소속사 필수. 스캔 시 해당 프로젝트·회사로 계정 가입합니다."}
              </div>
            </div>
            {registerUrl ? (
              <>
                <QRCodeSVG value={registerUrl} size={240} level="H" />
                <div className="text-xs text-muted-foreground break-all text-center">{registerUrl}</div>
                <Button variant="outline" onClick={() => { navigator.clipboard.writeText(registerUrl); toast.success("링크 복사됨"); }}>링크 복사</Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-6">소속사를 선택하면 QR이 표시됩니다.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <WorkerBulkImportDialog
        projectId={projectId}
        companyId={companyId}
        companyName={companies.find((c) => c.id === companyId)?.name || ""}
        open={showBulk}
        onClose={() => setShowBulk(false)}
        onDone={load}
      />

      <SuspendWorkerDialog
        open={!!suspendTarget}
        onOpenChange={(v) => !v && setSuspendTarget(null)}
        worker={suspendTarget}
        onDone={async () => {
          if (suspendTarget) {
            await log("site_entry_suspend", "workers", suspendTarget.id, projectId, {
              label: suspendTarget.name,
            });
          }
          load();
        }}
      />
    </div>
  );
}
