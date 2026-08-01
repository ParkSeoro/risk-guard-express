/**
 * Master-only PC Mobile Preview — phone frame + role/project controls.
 * Reuses real mobile routes/components without JWT impersonation.
 */
import { Suspense, useEffect, useMemo, useState } from "react";
import { MemoryRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { PreviewProvider, type PreviewMode } from "@/contexts/PreviewContext";
import MobileShell from "@/components/mobile/MobileShell";
import * as P from "@/routes/lazyPages";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Smartphone, RefreshCw } from "lucide-react";

const VIEWPORTS = [
  { id: "pixel7", label: "Pixel 7", w: 412, h: 915 },
  { id: "iphone14", label: "iPhone 14", w: 390, h: 844 },
  { id: "small", label: "Small Android", w: 360, h: 740 },
] as const;

const MODES: { id: PreviewMode; label: string }[] = [
  { id: "worker", label: "근로자" },
  { id: "supervisor", label: "관리감독자" },
  { id: "site_supervisor", label: "감리" },
  { id: "site_manager", label: "현장관리자" },
  { id: "project_admin", label: "프로젝트 관리자" },
  { id: "safety_manager", label: "안전관리자" },
  { id: "master", label: "마스터" },
];

function PreviewInnerRoutes() {
  return (
    <MobileShell>
      <Suspense
        fallback={<div className="p-6 text-sm text-muted-foreground">화면 로딩…</div>}
      >
        <Routes>
          <Route index element={<Navigate to="today" replace />} />
          <Route path="today" element={<P.LazyMobileToday />} />
          <Route path="tasks" element={<P.LazyMobileTasks />} />
          <Route path="docs" element={<P.LazyMobileDocs />} />
          <Route path="more" element={<P.LazyMobileMore />} />
          <Route path="home" element={<Navigate to="today" replace />} />
          <Route path="menu" element={<Navigate to="today" replace />} />
          <Route path="alerts" element={<P.LazyMobileAlerts />} />
          <Route path="actions" element={<P.LazyMobileActions />} />
          <Route path="approvals" element={<P.LazyMobileApprovals />} />
          <Route path="approvals/:approvalId" element={<P.LazyMobileApprovalDetail />} />
          <Route path="workers" element={<P.LazyMobileWorkers />} />
          <Route path="risk-assessment" element={<P.LazyMobileRiskAssessment />} />
          <Route path="risk-assessment/:runId" element={<P.LazyMobileAssessmentViewer />} />
          <Route path="work-plans" element={<P.LazyMobileWorkPlans />} />
          <Route path="work-plans/:planId" element={<P.LazyMobileWorkPlanViewer />} />
          <Route path="tbm" element={<P.LazyMobileTbm />} />
          <Route path="permits" element={<P.LazyMobilePermits />} />
          <Route path="incident" element={<P.LazyMobileIncident />} />
          <Route path="scan" element={<P.LazyMobileScan />} />
          <Route path="daily-health-log" element={<P.LazyMobileDailyHealthLog />} />
          <Route path="work-stop" element={<P.LazyMobileWorkStop />} />
          <Route path="inspect" element={<P.LazyMobileInspect />} />
          <Route path="*" element={<Navigate to="today" replace />} />
        </Routes>
      </Suspense>
    </MobileShell>
  );
}

export default function MobilePreviewHost() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<PreviewMode>("worker");
  const [projectId, setProjectId] = useState("");
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [viewportId, setViewportId] = useState<(typeof VIEWPORTS)[number]["id"]>("pixel7");
  const [frameKey, setFrameKey] = useState(0);

  const viewport = VIEWPORTS.find((v) => v.id === viewportId) || VIEWPORTS[0];

  useEffect(() => {
    const onBlock = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      toast.message(detail?.message || "프리뷰에서는 변경할 수 없습니다.");
    };
    window.addEventListener("mobile-preview:blocked-write", onBlock);
    return () => window.removeEventListener("mobile-preview:blocked-write", onBlock);
  }, []);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("projects").select("id, name").order("name").limit(80);
      const list = (data as any) || [];
      setProjects(list);
      if (!projectId && list[0]?.id) setProjectId(list[0].id);
    })();
  }, []);

  useEffect(() => {
    if (!projectId) return;
    try {
      localStorage.setItem("selectedProjectId", projectId);
      window.dispatchEvent(new Event("mobile:project-changed"));
    } catch {
      /* ignore */
    }
  }, [projectId]);

  const diag = useMemo(
    () => ({
      mode,
      projectId,
      viewport: viewport.id,
      path: "/app/worker/today",
      at: new Date().toISOString(),
    }),
    [mode, projectId, viewport.id],
  );

  return (
    <div className="space-y-4 max-w-6xl animate-fade-in" data-testid="mobile-preview-host">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Smartphone className="h-6 w-6" /> 모바일 프리뷰
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            PC에서 역할별 모바일 화면을 검수합니다. 실제 데이터는 읽기만 하고 변경하지 않습니다.
          </p>
        </div>
        <Badge variant="outline">마스터 전용</Badge>
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-4">
        <aside className="space-y-4 rounded-xl border p-4 bg-card">
          <div className="space-y-2">
            <Label>역할</Label>
            <select
              className="w-full h-10 rounded-md border bg-background px-2 text-sm"
              value={mode}
              onChange={(e) => {
                setMode(e.target.value as PreviewMode);
                setFrameKey((k) => k + 1);
              }}
            >
              {MODES.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>프로젝트</Label>
            <select
              className="w-full h-10 rounded-md border bg-background px-2 text-sm"
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setFrameKey((k) => k + 1);
              }}
            >
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            <Label>기기</Label>
            <select
              className="w-full h-10 rounded-md border bg-background px-2 text-sm"
              value={viewportId}
              onChange={(e) => setViewportId(e.target.value as any)}
            >
              {VIEWPORTS.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} ({v.w}×{v.h})
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => setFrameKey((k) => k + 1)}
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            프레임 새로고침
          </Button>
          <Button variant="ghost" className="w-full" onClick={() => navigate("/settings")}>
            설정으로
          </Button>
          <pre className="text-[10px] bg-muted rounded-md p-2 overflow-auto max-h-40">
            {JSON.stringify(diag, null, 2)}
          </pre>
        </aside>

        <div className="flex justify-center items-start p-4 rounded-xl border bg-muted/40 min-h-[640px]">
          <div
            className="relative rounded-[2rem] border-8 border-slate-800 bg-slate-900 shadow-2xl overflow-hidden"
            style={{ width: viewport.w + 16, height: viewport.h + 16 }}
            data-testid="preview-frame"
            data-preview-role={mode}
          >
            <div
              className="bg-background overflow-hidden"
              style={{ width: viewport.w, height: viewport.h }}
            >
              {projectId ? (
                <PreviewProvider key={frameKey} mode={mode} projectId={projectId}>
                  <MemoryRouter initialEntries={["/app/worker/today"]} initialIndex={0}>
                    <Routes>
                      <Route path="/app/worker/*" element={<PreviewInnerRoutes />} />
                      <Route path="*" element={<Navigate to="/app/worker/today" replace />} />
                    </Routes>
                  </MemoryRouter>
                </PreviewProvider>
              ) : (
                <div className="p-6 text-sm text-muted-foreground">프로젝트를 선택하세요.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
