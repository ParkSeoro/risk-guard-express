import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { FlaskConical, CheckCircle2, XCircle, Loader2, Trash2, Play } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import {
  createRun,
  persistResults,
  finalizeRun,
  cleanupRun,
  StepResult,
  TestContext,
} from "@/lib/systemTest/runner";
import { SCENARIOS, ScenarioKey } from "@/lib/systemTest/scenarios";
import { planCommand, applyStepFilter, COMMAND_HINTS } from "@/lib/systemTest/commandRouter";
import { Input } from "@/components/ui/input";

export default function SystemTestEngine() {
  const { hasRole, user } = useAuth();
  const isMaster = hasRole("master");

  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [projectId, setProjectId] = useState<string>("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: "", done: 0, total: 0 });
  const [results, setResults] = useState<StepResult[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [command, setCommand] = useState("");
  const [commandHint, setCommandHint] = useState<string>("");

  useEffect(() => {
    if (!isMaster) return;
    supabase.from("projects").select("id, name").order("name").then(({ data }) => {
      if (data) {
        setProjects(data);
        if (!projectId && data.length > 0) setProjectId(data[0].id);
      }
    });
    loadHistory();
  }, [isMaster]);

  const loadHistory = async () => {
    const { data } = await supabase
      .from("system_test_runs")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(10);
    if (data) setHistory(data);
  };

  if (!isMaster) return <Navigate to="/" replace />;

  const runScenarios = async (
    keys: ScenarioKey[],
    opts?: { stepFilter?: (s: StepResult) => boolean; scopeLabel?: string }
  ) => {
    if (!projectId || !user) {
      toast({ title: "프로젝트를 선택하세요", variant: "destructive" });
      return;
    }
    setRunning(true);
    setResults([]);
    const scope =
      opts?.scopeLabel ||
      (keys.length === Object.keys(SCENARIOS).length ? "all" : keys.join(","));
    const runId = await createRun(user.id, scope);
    setActiveRunId(runId);

    const all: StepResult[] = [];
    const ctx: TestContext = {
      runId,
      userId: user.id,
      projectId,
      artifacts: [],
      log: async () => {},
      onProgress: (cur, done, total) => setProgress({ current: cur, done, total }),
    };

    setProgress({ current: "시작", done: 0, total: keys.length });
    try {
      const ordered = [...keys].sort((a, b) => (a === "coverage" ? 1 : b === "coverage" ? -1 : 0));
      let idx = 0;
      for (const k of ordered) {
        idx++;
        setProgress({ current: SCENARIOS[k].label, done: idx - 1, total: ordered.length });
        ctx.priorResults = all;
        const stepResults = await SCENARIOS[k].run(ctx);
        all.push(...stepResults);
        const visible = opts?.stepFilter ? all.filter(opts.stepFilter) : all;
        setResults([...visible]);
      }
      const finalResults = opts?.stepFilter ? all.filter(opts.stepFilter) : all;
      await persistResults(runId, finalResults);
      await finalizeRun(runId, finalResults);
      const passed = finalResults.filter((r) => r.pass_fail === "pass").length;
      toast({
        title: `테스트 완료: ${passed}/${finalResults.length} PASS`,
        description: `Run ID: ${runId.slice(0, 8)}`,
      });
    } catch (err: any) {
      toast({ title: "테스트 오류", description: err?.message, variant: "destructive" });
    } finally {
      setProgress({ current: "정리 중...", done: keys.length, total: keys.length });
      await cleanupRun(runId);
      setRunning(false);
      loadHistory();
    }
  };

  const runCommand = async () => {
    const plan = planCommand(command);
    if (!plan.matched) {
      setCommandHint(plan.reason + " — 예시: " + COMMAND_HINTS.join(" / "));
      toast({ title: "명령 인식 실패", description: plan.reason, variant: "destructive" });
      return;
    }
    setCommandHint(plan.reason);
    await runScenarios(plan.scenarios, { stepFilter: plan.stepFilter, scopeLabel: `cmd:${command}` });
  };

  const groupedScores = useMemo(() => {
    const m: Record<string, { total: number; pass: number; label: string }> = {};
    for (const r of results) {
      const k = r.scenario_key as ScenarioKey;
      const label = SCENARIOS[k]?.label || r.scenario_key;
      m[k] = m[k] || { total: 0, pass: 0, label };
      m[k].total++;
      if (r.pass_fail === "pass") m[k].pass++;
    }
    return m;
  }, [results]);

  const exportCsv = () => {
    const header = "scenario,step,result,duration_ms,error\n";
    const rows = results
      .map((r) => `${r.scenario_key},${r.step_key},${r.pass_fail},${r.duration_ms},"${(r.error_location || "").replace(/"/g, "'")}"`)
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `system-test-${activeRunId?.slice(0, 8) || "results"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPass = results.filter((r) => r.pass_fail === "pass").length;
  const totalScore = results.length ? Math.round((totalPass / results.length) * 100) : 0;

  return (
    <div className="space-y-4 max-w-6xl mx-auto animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FlaskConical className="h-6 w-6" /> 시스템 테스트 엔진 <Badge variant="outline">Master</Badge>
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          시나리오/권한/연동/알림/무결성을 자동 검증합니다. 생성된 테스트 데이터는 종료 시 자동 정리됩니다.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <Label>대상 프로젝트</Label>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {projects.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => runScenarios(Object.keys(SCENARIOS) as ScenarioKey[])}
            disabled={running || !projectId}
          >
            {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            전체 실행
          </Button>
          {(Object.keys(SCENARIOS) as ScenarioKey[]).map((k) => (
            <Button
              key={k}
              variant="outline"
              size="sm"
              onClick={() => runScenarios([k])}
              disabled={running || !projectId}
            >
              {SCENARIOS[k].label}
            </Button>
          ))}
          {results.length > 0 && (
            <Button variant="ghost" size="sm" onClick={exportCsv}>CSV 내보내기</Button>
          )}
        </div>

        <div className="border-t pt-3 space-y-2">
          <Label>특정 기능 테스트 명령</Label>
          <div className="flex gap-2">
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !running) runCommand(); }}
              placeholder='예: "모바일 카메라", "/m/inspect", "TBM", "근로자 등록", "위험성평가"'
              disabled={running}
            />
            <Button onClick={runCommand} disabled={running || !projectId || !command.trim()}>
              <Play className="h-4 w-4 mr-1" /> 명령 실행
            </Button>
          </div>
          <div className="flex flex-wrap gap-1">
            {COMMAND_HINTS.map((h) => (
              <button
                key={h}
                type="button"
                className="text-xs px-2 py-0.5 rounded bg-muted hover:bg-muted/70"
                onClick={() => setCommand(h)}
              >
                {h}
              </button>
            ))}
          </div>
          {commandHint && (
            <div className="text-xs text-muted-foreground">→ {commandHint}</div>
          )}
        </div>

        {running && (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">
              진행 중: {progress.current} ({progress.done}/{progress.total})
            </div>
            <Progress value={progress.total ? (progress.done / progress.total) * 100 : 0} />
          </div>
        )}
      </Card>

      {results.length > 0 && (
        <>
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">기능별 점수</h2>
              <Badge variant={totalScore >= 80 ? "default" : "destructive"} className="text-base">
                총점 {totalScore}점
              </Badge>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {Object.entries(groupedScores).map(([k, v]) => {
                const pct = Math.round((v.pass / v.total) * 100);
                return (
                  <div key={k} className="border rounded p-3">
                    <div className="text-xs text-muted-foreground">{v.label}</div>
                    <div className="text-2xl font-bold">{pct}<span className="text-xs">점</span></div>
                    <div className="text-xs">{v.pass}/{v.total} PASS</div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="font-semibold mb-3">상세 결과</h2>
            <div className="space-y-1 text-sm">
              {results.map((r, i) => (
                <div key={i} className="flex items-center justify-between border-b last:border-0 py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    {r.pass_fail === "pass" ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                    ) : (
                      <XCircle className="h-4 w-4 text-destructive shrink-0" />
                    )}
                    <span className="font-mono text-xs">{r.scenario_key}.{r.step_key}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{r.duration_ms}ms</span>
                    {r.error_location && (
                      <span className="text-destructive truncate max-w-xs">{r.error_location}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}

      <Card className="p-4">
        <h2 className="font-semibold mb-3">최근 실행 이력</h2>
        <div className="space-y-2 text-sm">
          {history.length === 0 && <div className="text-muted-foreground">기록 없음</div>}
          {history.map((h) => (
            <div key={h.id} className="flex items-center justify-between border-b last:border-0 pb-2">
              <div className="flex items-center gap-2">
                <Badge variant={h.total_score >= 80 ? "default" : "destructive"}>
                  {h.total_score ?? "-"}점
                </Badge>
                <span className="text-xs">{h.scope}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date(h.started_at).toLocaleString("ko-KR")}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={async () => {
                  await cleanupRun(h.id);
                  toast({ title: "테스트 데이터 정리 완료" });
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
