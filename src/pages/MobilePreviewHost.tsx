/**
 * Master-only PC Mobile Preview — phone frame + role/project controls.
 * Loads real /app/worker routes in a same-origin iframe (no nested Router).
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PreviewMode } from "@/contexts/PreviewContext";
import {
  buildMobilePreviewSrc,
  MOBILE_PREVIEW_BLOCKED_MSG_TYPE,
  PREVIEW_MODES,
} from "@/lib/mobilePreview";
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

const MODE_LABELS: Record<PreviewMode, string> = {
  worker: "근로자",
  supervisor: "관리감독자",
  site_supervisor: "감리",
  site_manager: "현장관리자",
  project_admin: "프로젝트 관리자",
  safety_manager: "안전관리자",
  master: "마스터",
};

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
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== MOBILE_PREVIEW_BLOCKED_MSG_TYPE) return;
      toast.message(e.data?.message || "프리뷰에서는 변경할 수 없습니다.");
    };
    window.addEventListener("mobile-preview:blocked-write", onBlock);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("mobile-preview:blocked-write", onBlock);
      window.removeEventListener("message", onMessage);
    };
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

  const iframeSrc = useMemo(() => {
    if (!projectId) return "";
    return buildMobilePreviewSrc({ mode, projectId });
  }, [mode, projectId]);

  const diag = useMemo(
    () => ({
      mode,
      projectId,
      viewport: viewport.id,
      src: iframeSrc || null,
      at: new Date().toISOString(),
    }),
    [mode, projectId, viewport.id, iframeSrc],
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
              {PREVIEW_MODES.map((id) => (
                <option key={id} value={id}>
                  {MODE_LABELS[id]}
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
          <Button variant="ghost" className="w-full" onClick={() => navigate("/app/admin/settings")}>
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
              {iframeSrc ? (
                <iframe
                  key={`${frameKey}-${iframeSrc}`}
                  title="모바일 프리뷰"
                  src={iframeSrc}
                  className="border-0 bg-background"
                  style={{ width: viewport.w, height: viewport.h }}
                  data-testid="preview-iframe"
                />
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
