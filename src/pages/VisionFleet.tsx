import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useGlobalProjectAccess } from "@/components/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Camera, Video } from "lucide-react";
import { toast } from "sonner";
import VisionQuadGrid, { type QuadCamera } from "@/components/vision/VisionQuadGrid";
import VisionVpsSetup from "@/components/vision/VisionVpsSetup";
import VisionCameraManageList, { type ManageCamera } from "@/components/vision/VisionCameraManageList";
import { visionCanManage, visionQuadPageCount, visionRoleLabel, visionSafePlaybackUrl } from "@/lib/visionFleetApi";
import { visionVpsFromHost, type VisionVpsIngest, type VisionVpsRelay } from "@/lib/visionVps";
import { fetchProjectCompanies, type ProjectCompany } from "@/lib/projectCompanies";

type CameraRow = QuadCamera & { gateway_id: string; company_id?: string | null };

export default function VisionFleet() {
  const access = useGlobalProjectAccess();
  const { roles } = useAuth();
  const projectId = access.selectedProject;
  const canManage = visionCanManage(roles);
  const roleLabel = visionRoleLabel(roles);
  const [cameras, setCameras] = useState<CameraRow[]>([]);
  const [companies, setCompanies] = useState<ProjectCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [newCamName, setNewCamName] = useState("");
  const [newCamCompanyId, setNewCamCompanyId] = useState<string | null>(null);
  const [host, setHost] = useState("");
  const [relay, setRelay] = useState<VisionVpsRelay | null>(null);
  const [busy, setBusy] = useState(false);
  const [ingest, setIngest] = useState<VisionVpsIngest | null>(null);

  const load = async () => {
    if (!projectId) {
      setCameras([]);
      setLoading(false);
      return;
    }
    if (access.scopeStatus !== "ready") {
      setLoading(true);
      return;
    }
    setLoading(true);
    let query = supabase
      .from("vision_cameras" as any)
      .select("id, camera_id, name, health_state, gateway_id, playback_url, company_id")
      .eq("project_id", projectId);
    query = access.applyCompanyFilter(query, { includeOrphans: true });
    const { data, error } = await query.order("name");
    if (error) toast.error(error.message);
    setCameras((data || []) as CameraRow[]);
    setPage(0);
    setLoading(false);
  };

  const fleetCall = async (method: string, path: string, body?: unknown) => {
    const session = await supabase.auth.getSession();
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/vision-fleet${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${session.data.session?.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j as { error?: string }).error || res.statusText);
    return j;
  };

  const loadRelay = async () => {
    if (!canManage) return;
    try {
      const j = await fleetCall("GET", "/v1/cloud-relay");
      const next = (j as { data?: VisionVpsRelay }).data;
      if (next?.host) {
        setRelay(next);
        setHost(next.host);
      }
    } catch {
      /* not configured yet */
    }
  };

  useEffect(() => {
    void load();
  }, [projectId, access.scopeStatus, access.accessibleCompanyIds]);

  useEffect(() => {
    if (!projectId || !canManage) {
      setCompanies([]);
      return;
    }
    void fetchProjectCompanies(projectId).then(setCompanies);
  }, [projectId, canManage]);

  useEffect(() => {
    void loadRelay();
  }, [canManage]);

  const saveRelay = async () => {
    const parsed = visionVpsFromHost(host);
    if (!parsed) {
      toast.error("VPS 공인 IP 또는 도메인을 입력하세요");
      return;
    }
    setBusy(true);
    try {
      const j = await fleetCall("PUT", "/v1/cloud-relay", { host: parsed.host });
      const next = (j as { data?: VisionVpsRelay }).data;
      if (!next?.host) throw new Error("중계 주소를 저장하지 못했습니다");
      setRelay(next);
      setHost(next.host);
      toast.success("중계 주소를 저장했습니다");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "중계 저장 실패");
    } finally {
      setBusy(false);
    }
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
      const j = await fleetCall("POST", "/v1/cloud-cameras", {
        project_id: projectId,
        name,
        company_id: newCamCompanyId,
        provision: "vps",
      });
      const created = (j as { data?: { id?: string }; ingest?: VisionVpsIngest }).data;
      const next = (j as { ingest?: VisionVpsIngest }).ingest;
      if (created?.id) {
        await supabase
          .from("vision_cameras" as any)
          .update({ company_id: newCamCompanyId })
          .eq("id", created.id)
          .eq("project_id", projectId);
      }
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

  const saveCamera = async (
    cam: ManageCamera,
    next: { name: string; playback_url: string; company_id: string | null },
  ) => {
    if (!projectId) return;
    const playback_url = next.playback_url ? visionSafePlaybackUrl(next.playback_url) : null;
    if (next.playback_url && !playback_url) {
      toast.error("재생 주소가 올바르지 않습니다");
      return;
    }
    try {
      await fleetCall("PATCH", "/v1/cloud-cameras", {
        project_id: projectId,
        id: cam.id,
        name: next.name,
        playback_url,
        company_id: next.company_id,
      });
      await supabase
        .from("vision_cameras" as any)
        .update({ company_id: next.company_id })
        .eq("id", cam.id)
        .eq("project_id", projectId);
      toast.success("카메라 정보를 수정했습니다");
      void load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "수정 실패");
    }
  };

  const deleteCamera = async (cam: ManageCamera) => {
    if (!projectId) return;
    try {
      await fleetCall("DELETE", "/v1/cloud-cameras", { project_id: projectId, id: cam.id });
      toast.success("카메라를 삭제했습니다");
      void load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "삭제 실패");
    }
  };

  const revealIngest = async (cam: ManageCamera) => {
    if (!projectId) return;
    try {
      const j = await fleetCall("POST", "/v1/cloud-cameras/ingest", { project_id: projectId, id: cam.id });
      const next = (j as { ingest?: VisionVpsIngest }).ingest;
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
            {canManage
              ? "설정은 마스터만 합니다. 소속을 정하면 시공사는 하위까지, 협력사는 자사만 봅니다."
              : "현장 화면입니다. 자사·하위 협력사와 현장 공용 카메라만 보입니다."}
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
              <VisionVpsSetup
                host={host}
                onHostChange={setHost}
                onHostSave={saveRelay}
                name={newCamName}
                onNameChange={setNewCamName}
                companyId={newCamCompanyId}
                onCompanyChange={setNewCamCompanyId}
                companies={companies}
                ingest={ingest}
                relay={relay}
                busy={busy}
                onCreate={addCloudCamera}
              />
              <VisionCameraManageList
                cameras={cameras}
                companies={companies}
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
