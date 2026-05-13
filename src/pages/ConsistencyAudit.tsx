import { useMemo, useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GitCompare, Check, X, Minus, Info, Download, RefreshCw, Play } from "lucide-react";

// ============================================================
// 동적 일관성 감사
// Vite의 import.meta.glob(?raw)로 src/pages/*.tsx 소스를 직접 읽어
// 정규식 기반 룰 검사를 런타임에 수행한다. (코드 변경 시 자동 반영)
// ============================================================

type Status = "pass" | "fail" | "partial" | "na";

interface RuleDef {
  key: string;
  label: string;
  why: string;
  memoryRef: string;
  /** pass/partial/fail 판정 패턴 (둘 다 매칭되면 pass, 하나면 partial) */
  patterns: RegExp[];
  /** 이 패턴이 하나도 안 보이면 폼/입력이 없는 페이지로 간주 → na */
  applicabilityHint?: RegExp;
  /** 이 패턴이 매칭되면 룰 적용 자체를 면제 (admin-only / 데이터 비귀속 페이지 등) → na */
  excludeIf?: RegExp;
}

// 데이터 입력/수정 흐름이 거의 없는 시스템·관리·정보 페이지 — 격리/Zod 등 룰 면제
const ADMIN_INFO_PAGES = /^(?:AIAssistant|AILogs|AITestEngine|AuditLogs|ConsistencyAudit|Dashboard|Manual|PermissionTest|Profile|Settings|SettingsAccount|SettingsAI|SettingsNotifications|SettingsPermissions|SystemTestEngine|TodoDashboard|MobileAlerts|MobileHome|SiteWeather|MobileScan)\.tsx$/;

// 위험성평가/작업계획서/사고보고처럼 한국어 위험요인 텍스트를 다루는 페이지에서만 용어 보정 필요
const TERM_RELEVANT = /risk_items|hazard\s*[:=]|improvement_measure|sub_task|workplan_hazards|accident_cases/;

const RULES: RuleDef[] = [
  {
    key: "access",
    label: "프로젝트/회사 격리",
    why: "useProjectAccess / useMobileAccess / useGlobalProjectAccess 훅으로 회사·역할 격리 적용",
    memoryRef: "logic/project-access-hook",
    patterns: [
      /useProjectAccess|useMobileAccess|useGlobalProjectAccess/,
      /applyCompanyFilter|can_access_company_data|company_id|project_id|projectId/,
    ],
    // 실제 supabase 데이터 조회/쓰기를 하는 페이지에서만 격리 의미가 있음
    applicabilityHint: /supabase[\s\S]{0,200}\.from\(/,
  },
  {
    key: "soft",
    label: "소프트 삭제",
    why: "is_deleted 컬럼으로 복구 가능한 삭제 정책 적용",
    memoryRef: "system/soft-delete-policy",
    patterns: [/is_deleted/, /update.*is_deleted|\.update\(\s*\{[^}]*is_deleted/],
    applicabilityHint: /\.delete\(|deleteRow|onDelete|handleDelete/,
  },
  {
    key: "ime",
    label: "IME 한글 안정성",
    why: "한국어 자유 텍스트 입력에 IMESafeInput / IMESafeTextarea 사용",
    memoryRef: "tech/ime-stability",
    patterns: [
      /IMESafeInput|IMESafeTextarea/,
      /IMESafe(?:Input|Textarea)[\s\S]{0,800}IMESafe(?:Input|Textarea)|<IMESafe(?:Input|Textarea)[^>]*placeholder=["'][^"']*[\u3131-\uD79D]/,
    ],
    // 자유 한국어 텍스트 입력 후보가 있어야 적용 (search/email/password/number/file는 제외)
    applicabilityHint: /<Textarea |<Input(?![^>]*type=["'](?:search|email|password|number|file|date|time|hidden|checkbox|radio)["'])/,
    // QR/스캐너/프로필 등은 한국어 자유텍스트 폼이 아님
    excludeIf: /Html5Qrcode|QrScanner|Scanner/,
  },
  {
    key: "audit",
    label: "감사 로그",
    why: "데이터 변경(CRUD/오버라이드) 시 audit_log 기록",
    memoryRef: "features/audit-tracking",
    patterns: [/useAuditLog|audit_log|logAudit/, /logAudit\(|audit_log[\s\S]{0,300}insert|useAuditLog\(/],
    applicabilityHint: /supabase[\s\S]{0,200}\.(?:insert|update|delete)\(/,
  },
  {
    key: "zod",
    label: "Zod 검증",
    why: "폼 submit / insert 전에 zod schema로 데이터 검증",
    memoryRef: "tech/data-validation",
    patterns: [/from\s+["']zod["']|z\.object|z\.string|zodResolver/, /\.parse\(|\.safeParse\(|zodResolver/],
    // insert가 있는 페이지에서만 검증 룰 적용 (단순 status 토글/조회는 제외)
    applicabilityHint: /supabase[\s\S]{0,200}\.insert\(/,
  },
  {
    key: "toast",
    label: "에러 가시화",
    why: "catch 블록에서 toast로 사용자에게 오류 전달 (무음 금지)",
    memoryRef: "system/error-handling-policy",
    patterns: [/catch\s*\([^)]*\)\s*\{[\s\S]{0,400}toast/, /toast[\s\S]{0,80}(?:variant\s*:\s*["']destructive|title\s*:\s*["'][^"']*(?:오류|실패|에러))/],
    applicabilityHint: /try\s*\{[\s\S]*?catch/,
  },
  {
    key: "term",
    label: "용어 표준화",
    why: "위험요인/작업 텍스트 입력·저장 시 termCorrection으로 보정 (굴삭기→굴착기 등)",
    memoryRef: "system/terminology-standardization",
    patterns: [/correctTerms|termCorrection|correctItemTerms/, /correctTerms\(|correctItemTerms\(/],
    // 위험요인/공종 텍스트를 실제로 다루는 페이지만 적용
    applicabilityHint: TERM_RELEVANT,
  },
];

interface PageAudit {
  page: string;
  title: string;
  results: Record<string, Status>;
  size: number;
}

// Vite: 모든 페이지 소스를 raw 텍스트로 import
const PAGE_SOURCES = import.meta.glob("/src/pages/*.tsx", { as: "raw", eager: true }) as Record<string, string>;

// 페이지 표시명 매핑 (없으면 파일명 사용)
const TITLES: Record<string, string> = {
  "RiskAssessment.tsx": "위험성평가",
  "AssessmentRunDetail.tsx": "평가 회차 상세",
  "AssessmentRuns.tsx": "평가 회차 목록",
  "WorkPlans.tsx": "작업계획서 목록",
  "WorkPlanDetail.tsx": "작업계획서 상세",
  "WorkPermits.tsx": "작업허가서",
  "TbmLogs.tsx": "TBM 일지",
  "SafetyInspections.tsx": "안전점검",
  "SiteReadinessChecklist.tsx": "현장 적용 체크",
  "VerificationCenter.tsx": "검증센터",
  "EducationMaterials.tsx": "교육자료",
  "WorkerManagement.tsx": "근로자 관리",
  "SafetyCost.tsx": "산업안전보건관리비",
  "LegalDuties.tsx": "법적업무",
  "TodoDashboard.tsx": "할 일",
  "Approvals.tsx": "결재함",
  "MasterData.tsx": "기준정보",
  "Settings.tsx": "설정",
  "MobileHome.tsx": "[M] 홈",
  "MobileTbm.tsx": "[M] TBM",
  "MobileIncident.tsx": "[M] 사고 신고",
  "MobilePermits.tsx": "[M] 허가서 결재",
  "MobileApprovals.tsx": "[M] 결재함",
  "MobileActions.tsx": "[M] 조치 관리",
  "MobileInspect.tsx": "[M] 안전점검",
  "MobileWorkers.tsx": "[M] 근로자 QR",
  "MobileRiskAssessment.tsx": "[M] 위험성평가",
  "MobileWorkPlans.tsx": "[M] 작업계획",
  "MobileAlerts.tsx": "[M] 알림",
  "MobileScan.tsx": "[M] QR 스캔",
};

// 검사 제외 페이지 (라우팅용/스플래시)
const EXCLUDED = new Set(["NotFound.tsx", "Index.tsx", "Auth.tsx", "ResetPassword.tsx"]);

function evaluateRule(source: string, rule: RuleDef): Status {
  // applicabilityHint가 있고 매칭 안 되면 na
  if (rule.applicabilityHint && !rule.applicabilityHint.test(source)) {
    return "na";
  }
  const matches = rule.patterns.filter(p => p.test(source)).length;
  if (matches >= 2) return "pass";
  if (matches === 1) return "partial";
  return "fail";
}

function runAudit(): PageAudit[] {
  const results: PageAudit[] = [];
  for (const [path, source] of Object.entries(PAGE_SOURCES)) {
    const file = path.split("/").pop() ?? path;
    if (EXCLUDED.has(file)) continue;
    const r: Record<string, Status> = {};
    for (const rule of RULES) {
      r[rule.key] = evaluateRule(source, rule);
    }
    results.push({
      page: file,
      title: TITLES[file] ?? file.replace(".tsx", ""),
      results: r,
      size: source.length,
    });
  }
  // 모바일 우선 정렬 옵션은 UI에서, 여기선 알파벳
  return results.sort((a, b) => a.page.localeCompare(b.page));
}

const STATUS_META: Record<Status, { label: string; cls: string; icon: any }> = {
  pass:    { label: "적용", cls: "bg-success/15 text-success border-success/30", icon: Check },
  partial: { label: "일부", cls: "bg-warning/15 text-warning border-warning/30", icon: Minus },
  fail:    { label: "누락", cls: "bg-destructive/15 text-destructive border-destructive/30", icon: X },
  na:      { label: "해당없음", cls: "bg-muted text-muted-foreground border-border", icon: Minus },
};

export default function ConsistencyAudit() {
  const { hasRole } = useAuth();
  const isMaster = hasRole("master");
  const [filter, setFilter] = useState<"all" | "fail" | "partial" | "mobile">("all");
  const [audit, setAudit] = useState<PageAudit[]>([]);
  const [scanning, setScanning] = useState(false);
  const [lastScanAt, setLastScanAt] = useState<Date | null>(null);

  const performScan = () => {
    setScanning(true);
    // 시각적 피드백을 위해 짧은 지연
    setTimeout(() => {
      setAudit(runAudit());
      setLastScanAt(new Date());
      setScanning(false);
    }, 250);
  };

  useEffect(() => {
    performScan();
  }, []);

  const stats = useMemo(() => {
    let pass = 0, fail = 0, partial = 0, na = 0;
    audit.forEach(p => RULES.forEach(r => {
      const s = p.results[r.key];
      if (s === "pass") pass++;
      else if (s === "fail") fail++;
      else if (s === "partial") partial++;
      else na++;
    }));
    const applicable = pass + fail + partial;
    const score = applicable > 0 ? Math.round(((pass + partial * 0.5) / applicable) * 100) : 0;
    return { pass, fail, partial, na, applicable, score };
  }, [audit]);

  const mobileStats = useMemo(() => {
    const mobilePages = audit.filter(p => p.page.startsWith("Mobile"));
    let pass = 0, fail = 0, partial = 0;
    mobilePages.forEach(p => RULES.forEach(r => {
      const s = p.results[r.key];
      if (s === "pass") pass++;
      else if (s === "fail") fail++;
      else if (s === "partial") partial++;
    }));
    const applicable = pass + fail + partial;
    const score = applicable > 0 ? Math.round(((pass + partial * 0.5) / applicable) * 100) : 0;
    return { score, fail, partial, total: mobilePages.length };
  }, [audit]);

  const exportCsv = () => {
    const header = ["페이지", "제목", ...RULES.map(r => r.label)];
    const rows = audit.map(p => [
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

  const filtered = audit.filter(p => {
    if (filter === "mobile") return p.page.startsWith("Mobile");
    if (filter === "fail") return RULES.some(r => p.results[r.key] === "fail");
    if (filter === "partial") return RULES.some(r => p.results[r.key] === "partial");
    return true;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <GitCompare className="h-6 w-6" /> 공통 법칙 일관성 감사
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            실제 소스코드를 스캔해 모든 페이지가 공통 규칙을 따르는지 자동 점검합니다.
            {lastScanAt && (
              <span className="ml-2 text-xs">· 마지막 검사: {lastScanAt.toLocaleString("ko-KR")}</span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="default" size="sm" onClick={performScan} disabled={scanning}>
            {scanning ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
            {scanning ? "검사 중..." : "지금 검사 실행"}
          </Button>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={audit.length === 0}>
            <Download className="h-3.5 w-3.5 mr-1.5" /> CSV
          </Button>
        </div>
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

      {/* Mobile-specific summary */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="pt-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-xs font-semibold text-primary">📱 모바일 페이지 전용 점수</p>
              <p className="text-xs text-muted-foreground mt-1">
                모바일 페이지 {mobileStats.total}개 · 누락 {mobileStats.fail}건 · 일부 {mobileStats.partial}건
              </p>
            </div>
            <div className="text-right">
              <p className="text-3xl font-bold text-primary">{mobileStats.score}<span className="text-sm">%</span></p>
              <Button size="sm" variant="outline" className="mt-1 h-7 text-xs" onClick={() => setFilter("mobile")}>
                모바일만 보기
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Rules legend */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">점검 항목 (정규식 기반 자동 검사)</CardTitle>
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
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">필터:</span>
        {[
          { v: "all", label: `전체 (${audit.length})` },
          { v: "fail", label: "누락 포함" },
          { v: "partial", label: "일부 포함" },
          { v: "mobile", label: "📱 모바일만" },
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
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={RULES.length + 1} className="text-center p-8 text-muted-foreground text-xs">
                    {scanning ? "검사 중..." : "표시할 페이지가 없습니다."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="border-warning/30 bg-warning/5">
        <CardContent className="pt-4 text-xs text-muted-foreground space-y-1">
          <p className="font-semibold text-warning">참고</p>
          <p>· 이 매트릭스는 <strong>실제 소스코드 정규식 스캔</strong>으로 매번 새로 계산됩니다.</p>
          <p>· "해당없음(na)"은 페이지 성격상 룰이 적용되지 않는 경우(예: 입력 폼이 없는 화면).</p>
          <p>· "일부(partial)"는 일부 핸들러/폼에만 적용된 경우 — 누락된 위치를 확인하고 보완하세요.</p>
          <p>· 정규식 한계상 false-positive/negative 가능 — 누락 표시 페이지는 직접 확인 후 보완.</p>
        </CardContent>
      </Card>
    </div>
  );
}
