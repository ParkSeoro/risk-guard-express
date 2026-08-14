/**
 * 입퇴장 현황 — 일일 출역 및 법적 증빙 대시보드
 * Route: /app/admin/workers?tab=attendance (기존 사이드바 메뉴 유지)
 *
 * Data join (client-side enrichment, no new API):
 * 1) worker_entry_logs (date + project) — entry/exit + tbm_confirmed + no_accident_confirmed
 * 2) workers — name/phone/company
 * 3) tbm_sessions(tbm_date) ⨯ tbm_participations — same-day TBM attendance by worker_id/phone
 * 4) profiles by phone digits — legal consent timestamps (agreed_to_* / consent_agreed_at)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ClipboardList, Download, Search, AlertTriangle, CheckCircle2, LogIn, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useGlobalProjectAccess } from "@/components/AppLayout";

type ConsentInfo = {
  agreed_to_terms: boolean;
  agreed_to_location: boolean;
  agreed_to_privacy: boolean;
  consent_agreed_at: string | null;
  display_name?: string | null;
};

type EntryLog = {
  id: string;
  worker_id: string;
  entry_at: string;
  exit_at: string | null;
  risk_assessment_confirmed?: boolean;
  education_confirmed?: boolean;
  tbm_confirmed?: boolean;
  no_accident_confirmed?: boolean;
  workers?: { name?: string; phone?: string; company_name?: string };
  /** entry_log flag OR same-day tbm_participations hit */
  tbmAttended: boolean;
  tbmParticipationAt: string | null;
  consent: ConsentInfo | null;
};

type StatusFilter = "all" | "inside" | "exited" | "incomplete" | "pledge_warn";

function digits(phone?: string | null) {
  return (phone || "").replace(/\D/g, "");
}

function fmtTs(iso?: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ko-KR");
  } catch {
    return iso;
  }
}

function Mark({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? "text-emerald-600 font-semibold" : "text-rose-500 font-semibold"} aria-label={ok ? "예" : "아니오"}>
      {ok ? "✅" : "❌"}
    </span>
  );
}

export default function WorkerAttendance() {
  const [projectId, setProjectId] = useState<string>(() => localStorage.getItem("currentProjectId") || "");
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [logs, setLogs] = useState<EntryLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState<string>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<EntryLog | null>(null);
  const { accessibleCompanyIds, seesAllCompanies, applyCompanyFilter, scopeStatus } = useGlobalProjectAccess();

  useEffect(() => {
    supabase
      .from("projects")
      .select("id,name")
      .eq("is_deleted", false)
      .then(({ data }) => setProjects(data || []));
  }, []);

  const load = useCallback(async () => {
    if (!projectId || scopeStatus !== 'ready') return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("worker_entry_logs")
        .select(
          "id, worker_id, entry_at, exit_at, risk_assessment_confirmed, education_confirmed, tbm_confirmed, no_accident_confirmed",
        )
        .eq("project_id", projectId)
        .gte("entry_at", `${date}T00:00:00`)
        .lte("entry_at", `${date}T23:59:59`)
        .order("entry_at", { ascending: false });
      if (error) {
        toast.error(error.message);
        return;
      }

      const ids = Array.from(new Set((data || []).map((l) => l.worker_id).filter(Boolean)));
      let workersMap: Record<
        string,
        { id: string; name?: string; phone?: string; company_name?: string; company_id?: string | null }
      > = {};
      if (ids.length) {
        let wq = supabase
          .from("workers")
          .select("id,name,phone,company_name,company_id")
          .in("id", ids);
        wq = applyCompanyFilter(wq);
        const { data: ws } = await wq;
        workersMap = Object.fromEntries((ws || []).map((w) => [w.id, w]));
      }

      // Same-day TBM participations for this project (join via session.tbm_date)
      const tbmByWorkerId = new Map<string, string>();
      const tbmByPhone = new Map<string, string>();
      const { data: sessions } = await supabase
        .from("tbm_sessions")
        .select("id")
        .eq("project_id", projectId)
        .eq("tbm_date", date)
        .eq("is_deleted", false);
      const sessionIds = (sessions || []).map((s) => s.id);
      if (sessionIds.length) {
        const { data: parts } = await supabase
          .from("tbm_participations")
          .select("worker_id, worker_phone, participated_at, briefing_confirmed")
          .in("tbm_session_id", sessionIds);
        for (const p of parts || []) {
          if (p.briefing_confirmed === false) continue;
          const at = p.participated_at || "";
          if (p.worker_id) tbmByWorkerId.set(p.worker_id, at);
          const ph = digits(p.worker_phone);
          if (ph) tbmByPhone.set(ph, at);
        }
      }

      // Legal consent from profiles (phone digit match)
      const phones = Array.from(
        new Set(
          Object.values(workersMap)
            .map((w) => digits(w.phone))
            .filter((p) => p.length >= 8),
        ),
      );
      const consentByPhone = new Map<string, ConsentInfo>();
      if (phones.length) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select(
            "phone, display_name, agreed_to_terms, agreed_to_location, agreed_to_privacy, consent_agreed_at",
          )
          .not("phone", "is", null)
          .limit(2000);
        for (const pr of profiles || []) {
          const ph = digits(pr.phone);
          if (!ph || !phones.includes(ph)) continue;
          consentByPhone.set(ph, {
            agreed_to_terms: !!pr.agreed_to_terms,
            agreed_to_location: !!pr.agreed_to_location,
            agreed_to_privacy: !!pr.agreed_to_privacy,
            consent_agreed_at: pr.consent_agreed_at,
            display_name: pr.display_name,
          });
        }
      }

      setLogs(
        (data || [])
          // Drop logs for workers outside company scope (workersMap already filtered)
          .filter((l) => !!workersMap[l.worker_id] || seesAllCompanies)
          .map((l) => {
            const w = workersMap[l.worker_id];
            const phoneDig = digits(w?.phone);
            const tbmAt = tbmByWorkerId.get(l.worker_id) || (phoneDig ? tbmByPhone.get(phoneDig) : undefined) || null;
            const tbmAttended = !!l.tbm_confirmed || !!tbmAt;
            return {
              ...l,
              workers: w,
              tbmAttended,
              tbmParticipationAt: tbmAt,
              consent: phoneDig ? consentByPhone.get(phoneDig) || null : null,
            } as EntryLog;
          }),
      );
    } finally {
      setLoading(false);
    }
  }, [projectId, date, applyCompanyFilter, seesAllCompanies, scopeStatus]);

  useEffect(() => {
    if (!projectId) return;
    localStorage.setItem("currentProjectId", projectId);
    void load();
    const ch = supabase
      .channel(`worker_entry_logs:${projectId}:${date}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "worker_entry_logs", filter: `project_id=eq.${projectId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [projectId, date, load]);

  const companies = useMemo(() => {
    const set = new Set<string>();
    logs.forEach((l) => {
      if (l.workers?.company_name) set.add(l.workers.company_name);
    });
    return Array.from(set).sort();
  }, [logs]);

  const isIncomplete = (l: EntryLog) =>
    !(l.risk_assessment_confirmed && l.education_confirmed && l.tbmAttended);

  /** 퇴근은 됐는데 무재해 서약이 없는 비정상 */
  const isPledgeWarn = (l: EntryLog) => !!l.exit_at && !l.no_accident_confirmed;

  const counts = useMemo(() => {
    const c = { all: logs.length, inside: 0, exited: 0, incomplete: 0, noAccident: 0, pledgeWarn: 0 };
    for (const l of logs) {
      if (l.exit_at) c.exited++;
      else c.inside++;
      if (isIncomplete(l)) c.incomplete++;
      if (l.no_accident_confirmed) c.noAccident++;
      if (isPledgeWarn(l)) c.pledgeWarn++;
    }
    return c;
  }, [logs]);

  // Logs whose worker is outside company scope are dropped (workersMap already scoped).
  const scopedLogs = useMemo(() => {
    if (seesAllCompanies) return logs;
    const allow = new Set(accessibleCompanyIds || []);
    return logs.filter((l) => {
      const cid = (l as any).workers?.company_id as string | null | undefined;
      // Prefer company_id when present; else keep only if worker survived applyCompanyFilter join
      if (cid) return allow.has(cid);
      return !!(l as any).workers;
    });
  }, [logs, seesAllCompanies, accessibleCompanyIds]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return scopedLogs.filter((l) => {
      if (companyFilter !== "all" && l.workers?.company_name !== companyFilter) return false;
      if (status === "inside" && l.exit_at) return false;
      if (status === "exited" && !l.exit_at) return false;
      if (status === "incomplete" && !isIncomplete(l)) return false;
      if (status === "pledge_warn" && !isPledgeWarn(l)) return false;
      if (!q) return true;
      return (
        (l.workers?.name || "").toLowerCase().includes(q) ||
        (l.workers?.phone || "").toLowerCase().includes(q) ||
        (l.workers?.company_name || "").toLowerCase().includes(q)
      );
    });
  }, [scopedLogs, search, companyFilter, status]);

  const exportExcel = () => {
    const rows = filteredLogs.map((l) => ({
      이름: l.workers?.name || "",
      전화: l.workers?.phone || "",
      소속: l.workers?.company_name || "",
      입장시각: new Date(l.entry_at).toLocaleString("ko-KR"),
      퇴장시각: l.exit_at ? new Date(l.exit_at).toLocaleString("ko-KR") : "",
      "TBM 참석": l.tbmAttended ? "Y" : "N",
      "TBM 참석시각": l.tbmParticipationAt ? fmtTs(l.tbmParticipationAt) : "",
      "무재해 서약": l.no_accident_confirmed ? "Y" : "N",
      위험성평가확인: l.risk_assessment_confirmed ? "Y" : "N",
      교육확인: l.education_confirmed ? "Y" : "N",
      "위치정보 동의": l.consent?.agreed_to_location ? "Y" : "N",
      "개인정보 동의": l.consent?.agreed_to_privacy ? "Y" : "N",
      "이용약관 동의": l.consent?.agreed_to_terms ? "Y" : "N",
      "법적동의 일시": l.consent?.consent_agreed_at ? fmtTs(l.consent.consent_agreed_at) : "",
      비고: isPledgeWarn(l) ? "퇴근·무재해서약 불일치" : "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "일일출역서약");
    XLSX.writeFile(wb, `일일_출역_서약_대장_${date}.xlsx`);
    toast.success("엑셀 다운로드를 시작했습니다");
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6" /> 입퇴장 현황
          </h1>
          <p className="text-sm text-muted-foreground mt-1">일일 출역 및 법적 증빙 대시보드 · TBM·무재해 서약·동의 이력</p>
        </div>
        <Button onClick={exportExcel} className="gap-2 shrink-0">
          <Download className="h-4 w-4" />
          일일 출역/서약 대장 다운로드 (Excel)
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4 flex gap-2 items-end flex-wrap">
          <div>
            <Label>프로젝트</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="프로젝트 선택" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>날짜</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <Label>시공사</Label>
            <Select value={companyFilter} onValueChange={setCompanyFilter}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <Label>검색</Label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="이름·전화·소속"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">입장중</div>
              <div className="text-2xl font-bold">{counts.inside}</div>
            </div>
            <LogIn className="h-6 w-6 text-primary" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">퇴장완료</div>
              <div className="text-2xl font-bold">{counts.exited}</div>
            </div>
            <CheckCircle2 className="h-6 w-6 text-success" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">확인 미완</div>
              <div className="text-2xl font-bold text-destructive">{counts.incomplete}</div>
            </div>
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">무재해 서명</div>
              <div className="text-2xl font-bold">{counts.noAccident}</div>
            </div>
            <Badge className="bg-success">무재해</Badge>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">서약 경고</div>
              <div className="text-2xl font-bold text-rose-600">{counts.pledgeWarn}</div>
            </div>
            <AlertTriangle className="h-6 w-6 text-rose-500" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2 flex-wrap">
          <CardTitle>
            {date} 입퇴장 ({filteredLogs.length}/{scopedLogs.length}건)
          </CardTitle>
          <Tabs value={status} onValueChange={(v) => setStatus(v as StatusFilter)}>
            <TabsList>
              <TabsTrigger value="all">전체</TabsTrigger>
              <TabsTrigger value="inside">입장중</TabsTrigger>
              <TabsTrigger value="exited">퇴장</TabsTrigger>
              <TabsTrigger value="incomplete">확인미완</TabsTrigger>
              <TabsTrigger value="pledge_warn">서약경고</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">
              {scopedLogs.length === 0 ? "기록이 없습니다." : "필터에 해당하는 기록이 없습니다."}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="text-left p-2">근로자</th>
                    <th className="text-left p-2">소속</th>
                    <th className="text-left p-2">입장</th>
                    <th className="text-left p-2">퇴장</th>
                    <th className="text-center p-2">TBM 참석</th>
                    <th className="text-center p-2">무재해 서약</th>
                    <th className="text-left p-2">기타 확인</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((l) => {
                    const warn = isPledgeWarn(l);
                    return (
                      <tr
                        key={l.id}
                        className={`border-b cursor-pointer hover:bg-muted/40 transition-colors ${
                          warn ? "bg-rose-100/80 dark:bg-rose-950/40" : isIncomplete(l) ? "bg-destructive/5" : ""
                        }`}
                        onClick={() => setSelected(l)}
                      >
                        <td className="p-2">
                          <div className="font-medium">{l.workers?.name || "—"}</div>
                          <div className="text-xs text-muted-foreground">{l.workers?.phone}</div>
                        </td>
                        <td className="p-2">{l.workers?.company_name || "-"}</td>
                        <td className="p-2 text-xs">{new Date(l.entry_at).toLocaleTimeString("ko-KR")}</td>
                        <td className="p-2 text-xs">
                          {l.exit_at ? new Date(l.exit_at).toLocaleTimeString("ko-KR") : <Badge>입장중</Badge>}
                        </td>
                        <td className="p-2 text-center text-base">
                          <Mark ok={l.tbmAttended} />
                        </td>
                        <td className="p-2 text-center text-base">
                          <Mark ok={!!l.no_accident_confirmed} />
                        </td>
                        <td className="p-2">
                          <div className="flex gap-1 flex-wrap">
                            <Badge variant={l.risk_assessment_confirmed ? "outline" : "destructive"} className="text-xs">
                              위험
                            </Badge>
                            <Badge variant={l.education_confirmed ? "outline" : "destructive"} className="text-xs">
                              교육
                            </Badge>
                            {warn && (
                              <Badge variant="destructive" className="text-xs">
                                서약누락
                              </Badge>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-xs text-muted-foreground mt-2">행을 클릭하면 근로자 법적 동의 현황을 볼 수 있습니다.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-600" />
              근로자 법적 동의 현황
            </SheetTitle>
            <SheetDescription>
              {selected?.workers?.name || "근로자"} · {selected?.workers?.phone || "—"}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="mt-6 space-y-4 text-sm">
              <div className="rounded-lg border p-3 space-y-1 bg-muted/30">
                <div className="text-xs text-muted-foreground">당일 출역</div>
                <div>입장: {fmtTs(selected.entry_at)}</div>
                <div>퇴장: {selected.exit_at ? fmtTs(selected.exit_at) : "입장중"}</div>
                <div className="flex gap-3 pt-1">
                  <span>
                    TBM <Mark ok={selected.tbmAttended} />
                  </span>
                  <span>
                    무재해 <Mark ok={!!selected.no_accident_confirmed} />
                  </span>
                </div>
              </div>

              <div className="space-y-3">
                <h3 className="font-semibold">앱 최초 로그인 동의 (profiles)</h3>
                {selected.consent ? (
                  <>
                    <ConsentRow
                      label="위치정보 수집 동의"
                      agreed={selected.consent.agreed_to_location}
                      at={selected.consent.consent_agreed_at}
                    />
                    <ConsentRow
                      label="개인정보 처리방침 동의"
                      agreed={selected.consent.agreed_to_privacy}
                      at={selected.consent.consent_agreed_at}
                    />
                    <ConsentRow
                      label="이용약관 동의"
                      agreed={selected.consent.agreed_to_terms}
                      at={selected.consent.consent_agreed_at}
                    />
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      ※ 온보딩에서 필수 항목을 일괄 동의하므로 동의 일시는 `consent_agreed_at` 단일
                      타임스탬프를 공유합니다.
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    전화번호를 기준으로 연결된 앱 프로필 동의 기록이 없습니다. (QR 전용 근로자이거나 미동의)
                  </p>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ConsentRow({ label, agreed, at }: { label: string; agreed: boolean; at: string | null }) {
  return (
    <div className="rounded-md border px-3 py-2.5 flex items-start justify-between gap-3">
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground mt-0.5">동의 일시: {agreed ? fmtTs(at) : "미동의"}</div>
      </div>
      <Mark ok={agreed} />
    </div>
  );
}
