import { useState, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Database, RefreshCw, Wand2, CheckCircle2, AlertTriangle, ShieldAlert, Link2 } from "lucide-react";
import { useGlobalProjectAccessOptional } from "@/components/AppLayout";

interface AuditResult {
  generated_at: string;
  legacy_departments_not_migrated: number;
  legacy_assignees_not_migrated: number;
  orphan_risk_item_department_refs: number;
  duplicate_company_managers: number;
  workers_without_company: number;
  total_issues: number;
}

interface IntegrityFinding {
  code: string;
  severity: string;
  count: number;
  detail: string;
}

interface MigrationResult {
  migrated_departments?: number;
  migrated_managers?: number;
  target_company_id?: string;
  error?: string;
}

const ROW_META: Array<{ key: keyof AuditResult; label: string; help: string }> = [
  { key: "legacy_departments_not_migrated", label: "미이관 레거시 부서", help: "master_departments → company_departments 로 옮겨야 할 부서 수" },
  { key: "legacy_assignees_not_migrated", label: "미이관 레거시 담당자", help: "department_assignees → company_managers 로 옮겨야 할 담당자 수" },
  { key: "orphan_risk_item_department_refs", label: "고아 부서 참조 (위험성평가)", help: "어느 테이블에도 존재하지 않는 부서 ID를 가리키는 위험요인" },
  { key: "duplicate_company_managers", label: "중복 담당자 매핑", help: "같은 회사·같은 사용자가 중복으로 매니저 등록된 건수" },
  { key: "workers_without_company", label: "회사 미배정 근로자", help: "company_id 가 비어있는 활성 근로자 수" },
];

export default function DataAudit() {
  const { hasRole } = useAuth();
  const { toast } = useToast();
  const access = useGlobalProjectAccessOptional();
  const isMaster = hasRole("master");
  const [audit, setAudit] = useState<AuditResult | null>(null);
  const [findings, setFindings] = useState<IntegrityFinding[]>([]);
  const [loading, setLoading] = useState(false);
  const [migrating, setMigrating] = useState(false);

  const runAudit = async () => {
    setLoading(true);
    try {
      const projectId = access?.selectedProject || null;
      const [ssot, integ] = await Promise.all([
        supabase.rpc("audit_data_consistency" as any),
        supabase.rpc("check_data_integrity" as any, { _project_id: projectId }),
      ]);
      if (ssot.error) throw ssot.error;
      setAudit(ssot.data as unknown as AuditResult);

      if (integ.error) {
        toast({
          variant: "destructive",
          title: "교차 무결성 점검 실패",
          description: integ.error.message ?? String(integ.error),
        });
        setFindings([]);
      } else {
        const raw = integ.data as unknown;
        setFindings(Array.isArray(raw) ? (raw as IntegrityFinding[]) : []);
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "정합성 점검 실패", description: e.message ?? String(e) });
    } finally {
      setLoading(false);
    }
  };

  const runMigration = async () => {
    if (!confirm("레거시 부서·담당자를 SSOT(company_departments / company_managers)로 자동 이관합니다. 진행할까요?")) return;
    setMigrating(true);
    try {
      const { data, error } = await supabase.rpc("migrate_legacy_to_ssot" as any, { _project_id: null });
      if (error) throw error;
      const res = data as unknown as MigrationResult;
      if (res?.error) throw new Error(res.error);
      toast({
        title: "이관 완료",
        description: `부서 ${res.migrated_departments ?? 0}건, 담당자 ${res.migrated_managers ?? 0}건이 SSOT로 복제되었습니다.`,
      });
      await runAudit();
    } catch (e: any) {
      toast({ variant: "destructive", title: "이관 실패", description: e.message ?? String(e) });
    } finally {
      setMigrating(false);
    }
  };

  useEffect(() => {
    if (isMaster) void runAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMaster, access?.selectedProject]);

  if (!isMaster) return <Navigate to="/" replace />;

  const totalIssues = audit?.total_issues ?? 0;
  const highFindings = findings.filter((f) => f.severity === "high" || f.severity === "critical");

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Database className="h-6 w-6" /> 데이터 정합성 점검
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            SSOT 이관 상태와 교차 테이블 무결성을 점검합니다. 마스터 전용. 야간 cron이 이슈를 알림으로 보냅니다.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={runAudit} disabled={loading}>
            {loading ? <RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
            다시 점검
          </Button>
          <Button size="sm" onClick={runMigration} disabled={migrating || totalIssues === 0}>
            <Wand2 className="h-3.5 w-3.5 mr-1.5" />
            {migrating ? "이관 중..." : "레거시 → SSOT 자동 이관"}
          </Button>
        </div>
      </div>

      {audit && (
        totalIssues === 0 ? (
          <Alert className="border-success/40 bg-success/5">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <AlertTitle>SSOT 정합성 이상 없음</AlertTitle>
            <AlertDescription>
              마지막 점검 {new Date(audit.generated_at).toLocaleString("ko-KR")}.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert className="border-warning/40 bg-warning/5">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <AlertTitle>총 {totalIssues}건의 SSOT 정합성 이슈가 있습니다</AlertTitle>
            <AlertDescription>
              아래 항목을 확인하시고, 1클릭 이관 버튼으로 레거시 데이터를 SSOT로 복제할 수 있습니다.
            </AlertDescription>
          </Alert>
        )
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ShieldAlert className="h-4 w-4" /> SSOT 점검 항목
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left p-3 font-medium">항목</th>
                <th className="text-right p-3 font-medium w-32">건수</th>
                <th className="text-left p-3 font-medium hidden md:table-cell">설명</th>
              </tr>
            </thead>
            <tbody>
              {ROW_META.map((row) => {
                const v = (audit?.[row.key] as number | undefined) ?? 0;
                return (
                  <tr key={row.key} className="border-t">
                    <td className="p-3 font-medium">{row.label}</td>
                    <td className="p-3 text-right">
                      <Badge variant={v === 0 ? "outline" : "destructive"} className="text-sm">
                        {v}
                      </Badge>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground hidden md:table-cell">{row.help}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Link2 className="h-4 w-4" /> 교차 테이블 무결성
            </span>
            <Badge variant={highFindings.length ? "destructive" : "outline"}>
              {findings.length} findings · high {highFindings.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {findings.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">교차 무결성 이슈가 없거나, 프로젝트 선택 후 다시 점검하세요.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-3 font-medium">코드</th>
                  <th className="text-left p-3 font-medium w-24">심각도</th>
                  <th className="text-right p-3 font-medium w-20">건수</th>
                  <th className="text-left p-3 font-medium hidden md:table-cell">상세</th>
                </tr>
              </thead>
              <tbody>
                {findings.map((f) => (
                  <tr key={`${f.code}-${f.severity}`} className="border-t">
                    <td className="p-3 font-mono text-xs">{f.code}</td>
                    <td className="p-3">
                      <Badge variant={f.severity === "high" || f.severity === "critical" ? "destructive" : "outline"}>
                        {f.severity}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">{f.count}</td>
                    <td className="p-3 text-xs text-muted-foreground hidden md:table-cell">{f.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        SSOT: <code className="bg-muted px-1 rounded">company_departments</code> +{" "}
        <code className="bg-muted px-1 rounded">company_managers</code>. 교차 점검은{" "}
        <code className="bg-muted px-1 rounded">check_data_integrity</code> RPC. 회귀 전수는{" "}
        <a className="underline" href="/app/admin/system-test">시스템 테스트 엔진</a>을 사용하세요.
      </p>
    </div>
  );
}
