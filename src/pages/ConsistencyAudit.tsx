import { useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GitCompare, Check, X, Minus, Info, Download } from "lucide-react";

// ============================================================
// 정적 감사 결과 (코드 grep 기반, 2025-05 스냅샷)
// 자동 갱신 대상이 아니며 코드 변경 시 수동으로 갱신해야 함.
// ============================================================

type Status = "pass" | "fail" | "partial" | "na";

interface RuleDef {
  key: string;
  label: string;
  why: string;
  memoryRef: string;
}

const RULES: RuleDef[] = [
  { key: "access",    label: "프로젝트/회사 격리",      why: "useProjectAccess / useGlobalProjectAccess 훅으로 회사·역할 격리 적용", memoryRef: "logic/project-access-hook" },
  { key: "soft",      label: "소프트 삭제",             why: "is_deleted 컬럼으로 복구 가능한 삭제 정책 적용", memoryRef: "system/soft-delete-policy" },
  { key: "ime",       label: "IME 한글 안정성",         why: "한글 입력 폼에 IMESafeInput 사용 (조합 중 끊김 방지)", memoryRef: "tech/ime-stability" },
  { key: "audit",     label: "감사 로그",               why: "CRUD/오버라이드 발생 시 audit_log 기록", memoryRef: "features/audit-tracking" },
  { key: "zod",       label: "Zod 검증",                why: "폼 submit 시 schema.parse로 데이터 검증", memoryRef: "tech/data-validation" },
  { key: "toast",     label: "에러 가시화",             why: "catch 블록에서 toast로 사용자에게 오류 전달 (무음 금지)", memoryRef: "system/error-handling-policy" },
  { key: "term",      label: "용어 표준화",             why: "termCorrection으로 굴삭기→굴착기 등 자동 보정", memoryRef: "system/terminology-standardization" },
];

interface PageAudit {
  page: string;
  title: string;
  results: Record<string, Status>;
  // optional manual notes per rule
  notes?: Partial<Record<string, string>>;
}

// 수치는 src/pages/*.tsx grep 결과 기반. pass: >=2, partial: 1, fail: 0
// na: 해당 페이지에 입력 폼이 없어 룰이 적용되지 않는 경우
const AUDIT: PageAudit[] = [
  { page: "RiskAssessment.tsx",        title: "위험성평가",        results: { access: "fail",    soft: "fail",    ime: "pass",    audit: "pass",    zod: "fail", toast: "fail",    term: "fail" } },
  { page: "AssessmentRunDetail.tsx",   title: "평가 회차 상세",    results: { access: "fail",    soft: "partial", ime: "pass",    audit: "pass",    zod: "fail", toast: "fail",    term: "fail" } },
  { page: "WorkPlans.tsx",             title: "작업계획서 목록",   results: { access: "pass",    soft: "fail",    ime: "na",      audit: "fail",    zod: "na",   toast: "fail",    term: "na" } },
  { page: "WorkPlanDetail.tsx",        title: "작업계획서 상세",   results: { access: "pass",    soft: "fail",    ime: "fail",    audit: "fail",    zod: "pass", toast: "fail",    term: "fail" } },
  { page: "WorkPermits.tsx",           title: "작업허가서",        results: { access: "fail",    soft: "partial", ime: "fail",    audit: "fail",    zod: "fail", toast: "fail",    term: "fail" } },
  { page: "TbmLogs.tsx",               title: "TBM 일지",          results: { access: "fail",    soft: "fail",    ime: "fail",    audit: "fail",    zod: "fail", toast: "fail",    term: "fail" } },
  { page: "SafetyInspections.tsx",     title: "안전점검",          results: { access: "pass",    soft: "pass",    ime: "pass",    audit: "fail",    zod: "fail", toast: "fail",    term: "fail" } },
  { page: "SiteReadinessChecklist.tsx",title: "현장 적용 체크",    results: { access: "fail",    soft: "partial", ime: "fail",    audit: "fail",    zod: "fail", toast: "fail",    term: "na" } },
  { page: "VerificationCenter.tsx",    title: "검증센터",          results: { access: "fail",    soft: "fail",    ime: "na",      audit: "pass",    zod: "na",   toast: "fail",    term: "na" } },
  { page: "EducationMaterials.tsx",    title: "교육자료",          results: { access: "fail",    soft: "partial", ime: "fail",    audit: "fail",    zod: "pass", toast: "pass",    term: "fail" } },
  { page: "WorkerManagement.tsx",      title: "근로자 관리",       results: { access: "fail",    soft: "fail",    ime: "fail",    audit: "fail",    zod: "fail", toast: "pass",    term: "na" } },
  { page: "SafetyCost.tsx",            title: "산업안전보건관리비",results: { access: "pass",    soft: "fail",    ime: "fail",    audit: "pass",    zod: "fail", toast: "fail",    term: "fail" } },
  { page: "LegalDuties.tsx",           title: "법적업무",          results: { access: "pass",    soft: "fail",    ime: "fail",    audit: "fail",    zod: "fail", toast: "fail",    term: "na" } },
  { page: "TodoDashboard.tsx",         title: "할 일",             results: { access: "pass",    soft: "fail",    ime: "fail",    audit: "fail",    zod: "fail", toast: "fail",    term: "na" } },
  { page: "Approvals.tsx",             title: "결재함",            results: { access: "pass",    soft: "fail",    ime: "na",      audit: "pass",    zod: "na",   toast: "fail",    term: "na" } },
  { page: "MasterData.tsx",            title: "기준정보",          results: { access: "fail",    soft: "fail",    ime: "fail",    audit: "fail",    zod: "fail", toast: "fail",    term: "fail" } },
  { page: "Settings.tsx",              title: "설정",              results: { access: "na",      soft: "na",      ime: "na",      audit: "na",      zod: "na",   toast: "na",      term: "na" } },

  // ====== 모바일 (이번 라운드 수정 후) ======
  { page: "MobileHome.tsx",            title: "[M] 홈",            results: { access: "pass",    soft: "na",      ime: "na",      audit: "na",      zod: "na",   toast: "pass",    term: "na" } },
  { page: "MobileTbm.tsx",             title: "[M] TBM",           results: { access: "pass",    soft: "na",      ime: "pass",    audit: "pass",    zod: "fail", toast: "pass",    term: "pass" } },
  { page: "MobileIncident.tsx",        title: "[M] 사고 신고",     results: { access: "pass",    soft: "pass",    ime: "pass",    audit: "pass",    zod: "fail", toast: "pass",    term: "pass" } },
  { page: "MobilePermits.tsx",         title: "[M] 허가서 결재",   results: { access: "pass",    soft: "na",      ime: "pass",    audit: "pass",    zod: "fail", toast: "pass",    term: "na" } },
  { page: "MobileApprovals.tsx",       title: "[M] 결재함",        results: { access: "na",      soft: "na",      ime: "pass",    audit: "pass",    zod: "na",   toast: "pass",    term: "na" } },
  { page: "MobileActions.tsx",         title: "[M] 조치 관리",     results: { access: "pass",    soft: "na",      ime: "pass",    audit: "pass",    zod: "fail", toast: "pass",    term: "pass" } },
  { page: "MobileInspect.tsx",         title: "[M] 안전점검",      results: { access: "fail",    soft: "na",      ime: "fail",    audit: "fail",    zod: "fail", toast: "pass",    term: "fail" } },
  { page: "MobileWorkers.tsx",         title: "[M] 근로자 QR",     results: { access: "pass",    soft: "na",      ime: "fail",    audit: "fail",    zod: "na",   toast: "pass",    term: "na" } },
  { page: "MobileRiskAssessment.tsx",  title: "[M] 위험성평가",    results: { access: "pass",    soft: "pass",    ime: "fail",    audit: "na",      zod: "na",   toast: "fail",    term: "na" } },
  { page: "MobileWorkPlans.tsx",       title: "[M] 작업계획",      results: { access: "pass",    soft: "pass",    ime: "fail",    audit: "na",      zod: "na",   toast: "fail",    term: "na" } },
  { page: "MobileAlerts.tsx",          title: "[M] 알림",          results: { access: "na",      soft: "na",      ime: "na",      audit: "na",      zod: "na",   toast: "fail",    term: "na" } },
  { page: "MobileScan.tsx",            title: "[M] QR 스캔",       results: { access: "na",      soft: "na",      ime: "na",      audit: "na",      zod: "na",   toast: "pass",    term: "na" } },
];

const STATUS_META: Record<Status, { label: string; cls: string; icon: any }> = {
  pass:    { label: "적용", cls: "bg-success/15 text-success border-success/30", icon: Check },
  partial: { label: "일부", cls: "bg-warning/15 text-warning border-warning/30", icon: Minus },
  fail:    { label: "누락", cls: "bg-destructive/15 text-destructive border-destructive/30", icon: X },
  na:      { label: "해당없음", cls: "bg-muted text-muted-foreground border-border", icon: Minus },
};

export default function ConsistencyAudit() {
  const { hasRole } = useAuth();
  const isMaster = hasRole("master");
  const [filter, setFilter] = useState<"all" | "fail" | "partial">("all");

  const stats = useMemo(() => {
    let pass = 0, fail = 0, partial = 0, na = 0;
    AUDIT.forEach(p => RULES.forEach(r => {
      const s = p.results[r.key];
      if (s === "pass") pass++;
      else if (s === "fail") fail++;
      else if (s === "partial") partial++;
      else na++;
    }));
    const applicable = pass + fail + partial;
    const score = applicable > 0 ? Math.round((pass / applicable) * 100) : 0;
    return { pass, fail, partial, na, applicable, score };
  }, []);

  const exportCsv = () => {
    const header = ["페이지", "제목", ...RULES.map(r => r.label)];
    const rows = AUDIT.map(p => [
      p.page, p.title,
      ...RULES.map(r => STATUS_META[p.results[r.key]].label),
    ]);
    const csv = "\uFEFF" + [header, ...rows].map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `consistency-audit-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  if (!isMaster) return <Navigate to="/" replace />;

  const filtered = filter === "all" ? AUDIT : AUDIT.filter(p =>
    RULES.some(r => p.results[r.key] === filter)
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitCompare className="h-6 w-6" /> 공통 법칙 일관성 감사
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            모든 페이지가 프로젝트 공통 규칙(격리·삭제·IME·감사·검증·에러처리·용어)을 따르는지 점검합니다.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
        </Button>
      </div>

      {/* Score summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">전체 점수</p>
            <p className="text-2xl font-bold text-primary mt-1">{stats.score}<span className="text-sm">%</span></p>
            <p className="text-[10px] text-muted-foreground mt-1">{stats.pass}/{stats.applicable} 적용</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">적용</p>
            <p className="text-2xl font-bold text-success mt-1">{stats.pass}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">일부</p>
            <p className="text-2xl font-bold text-warning mt-1">{stats.partial}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">누락</p>
            <p className="text-2xl font-bold text-destructive mt-1">{stats.fail}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-muted-foreground">해당없음</p>
            <p className="text-2xl font-bold text-muted-foreground mt-1">{stats.na}</p>
          </CardContent>
        </Card>
      </div>

      {/* Rules legend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">점검 항목</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {RULES.map(r => (
              <div key={r.key} className="flex items-start gap-2 p-2 rounded border border-border bg-muted/30">
                <Info className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">{r.label}</div>
                  <div className="text-muted-foreground">{r.why}</div>
                  <div className="text-[10px] text-muted-foreground/70 mt-0.5">mem://{r.memoryRef}</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">필터:</span>
        {[
          { v: "all", label: "전체" },
          { v: "fail", label: "누락 포함" },
          { v: "partial", label: "일부 포함" },
        ].map(o => (
          <Button
            key={o.v}
            size="sm"
            variant={filter === o.v ? "default" : "outline"}
            onClick={() => setFilter(o.v as any)}
            className="h-7 text-xs"
          >
            {o.label}
          </Button>
        ))}
      </div>

      {/* Matrix */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left p-2 min-w-[200px]">페이지</th>
                {RULES.map(r => (
                  <th key={r.key} className="text-center p-2 min-w-[80px]" title={r.why}>
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.page} className="border-b hover:bg-muted/30">
                  <td className="p-2">
                    <div className="font-semibold">{p.title}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{p.page}</div>
                  </td>
                  {RULES.map(r => {
                    const s = p.results[r.key];
                    const meta = STATUS_META[s];
                    const I = meta.icon;
                    return (
                      <td key={r.key} className="p-2 text-center">
                        <Badge variant="outline" className={`text-[10px] ${meta.cls}`}>
                          <I className="h-3 w-3 mr-1" />
                          {meta.label}
                        </Badge>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="border-warning/30 bg-warning/5">
        <CardContent className="pt-4 text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-warning">참고</p>
          <p>· 이 매트릭스는 코드 정적 분석 스냅샷이며, 코드 변경 시 수동 갱신이 필요합니다.</p>
          <p>· "해당없음(na)"은 페이지 성격상 룰이 적용되지 않는 경우(예: 입력 폼이 없는 화면).</p>
          <p>· "일부(partial)"는 일부 핸들러/폼에만 적용된 경우 — 누락된 위치를 확인하고 보완하세요.</p>
          <p>· 후속 작업: 누락 항목을 별도 todo로 분리해 점진적으로 보완 권장.</p>
        </CardContent>
      </Card>
    </div>
  );
}
