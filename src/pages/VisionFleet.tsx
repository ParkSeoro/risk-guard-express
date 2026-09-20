import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useGlobalProjectAccess } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Camera, Video } from "lucide-react";
import { toast } from "sonner";
import VisionQuadGrid, { type QuadCamera } from "@/components/vision/VisionQuadGrid";
import VisionMuxSetup from "@/components/vision/VisionMuxSetup";
import VisionCameraManageList, { type ManageCamera } from "@/components/vision/VisionCameraManageList";
import { visionCanManage, visionQuadPageCount, visionRoleLabel, visionSafePlaybackUrl } from "@/lib/visionFleetApi";
import { type VisionMuxIngest } from "@/lib/visionMux";

type CameraRow = QuadCamera & { gateway_id: string };

export default function VisionFleet() {
  const access = useGlobalProjectAccess();
  const { roles } = useAuth();
  const projectId = access.selectedProject;
  const canManage = visionCanManage(roles);
  const roleLabel = visionRoleLabel(roles);
  const [cameras, setCameras] = useState<CameraRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [newCamName, setNewCamName] = useState("");
  const [busy, setBusy] = useState(false);
  const [ingest, setIngest] = useState<VisionMuxIngest | null>(null);

  const load = async () => {
    if (!projectId) {
      setCameras([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("vision_cameras" as any)
      .select("id, camera_id, name, health_state, gateway_id, playback_url")
      .eq("project_id", projectId)
      .order("name");
    if (error) toast.error(error.message);
    setCameras((data || []) as CameraRow[]);
    setPage(0);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [projectId]);

  const fleetPost = async (method: string, path: string, body: unknown) => {
    const session = await supabase.auth.getSession();
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vision-fleet${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${session.data.session?.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j as { error?: string }).error || res.statusText);
    return j;
  };

  const addCloudCamera = async () => {
    if (!projectId || !canManage) return;
    const name = newCamName.trim();
    if (!name) {
      toast.error("카메라 이름을 입력하세요");
      return;
    }
    setBusy(true);
    try {
      const j = await fleetPost("POST", "/v1/cloud-cameras", {
        project_id: projectId,
        name,
        provision: "mux",
      });
      const next = (j as { ingest?: VisionMuxIngest }).ingest;
      if (next?.stream_key) setIngest(next);
      toast.success("카메라를 만들었습니다. 아래 키를 VIGI RTMP에 넣으세요.");
      setNewCamName("");
      void load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "카메라 추가 실패");
    } finally {
      setBusy(false);
    }
  };

  const saveCamera = async (cam: ManageCamera, next: { name: string; playback_url: string }) => {
    if (!projectId) return;
    const playback_url = next.playback_url ? visionSafePlaybackUrl(next.playback_url) : null;
    if (next.playback_url && !playback_url) {
      toast.error("재생 주소가 올바르지 않습니다");
      return;
    }
    try {
      await fleetPost("PATCH", "/v1/cloud-cameras", {
        project_id: projectId,
        id: cam.id,
        name: next.name,
        playback_url,
      });
      toast.success("카메라 정보를 수정했습니다");
      void load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "수정 실패");
    }
  };

  const deleteCamera = async (cam: ManageCamera) => {
    if (!projectId) return;
    try {
      await fleetPost("DELETE", "/v1/cloud-cameras", { project_id: projectId, id: cam.id });
      toast.success("카메라를 삭제했습니다");
      void load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "삭제 실패");
    }
  };

  const revealIngest = async (cam: ManageCamera) => {
    if (!projectId) return;
    try {
      const j = await fleetPost("POST", "/v1/cloud-cameras/ingest", { project_id: projectId, id: cam.id });
      const next = (j as { ingest?: VisionMuxIngest }).ingest;
      if (!next?.stream_key) throw new Error("송출 정보가 없습니다");
      setIngest(next);
      toast.success("송출 정보를 다시 불러왔습니다");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "송출 정보 실패");
    }
  };

  const pageCount = visionQuadPageCount(cameras.length);
  const safePage = Math.min(page, pageCount - 1);

  return (
    <div className="p-6 space-y-4 max-w-6xl mx-auto" data-testid="vision-fleet">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Video className="h-5 w-5" /> 비전 관제
          </h1>
          <p className="text-xs text-muted-foreground">
            {canManage ? "설정은 마스터만 합니다. 카메라는 4대씩 넘깁니다." : "현장 화면입니다. 카메라는 4대씩 넘깁니다."}
          </p>
        </div>
        <Badge variant="secondary">{roleLabel}{canManage ? " · 설정" : ""}</Badge>
      </div>

      {!projectId && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">프로젝트를 선택하면 이 현장의 화면이 열립니다.</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Camera className="h-4 w-4" /> {loading ? "불러오는 중" : "카메라 보드"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <VisionQuadGrid cameras={cameras} page={safePage} onPageChange={setPage} />
          {canManage && (
            <>
              <VisionMuxSetup
                name={newCamName}
                onNameChange={setNewCamName}
                ingest={ingest}
                busy={busy}
                onCreate={addCloudCamera}
              />
              <VisionCameraManageList
                cameras={cameras}
                onSave={saveCamera}
                onDelete={deleteCamera}
                onRevealIngest={revealIngest}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
