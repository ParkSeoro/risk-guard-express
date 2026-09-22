import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import MobilePageHeader from "@/components/mobile/MobilePageHeader";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import MobileVisionPlayer from "@/components/vision/MobileVisionPlayer";
import type { MobileVisionCamera } from "@/lib/mobileVisionPlayer";
import { sortVisionCamerasByRegistered, visionCanManage, visionRoleLabel } from "@/lib/visionFleetApi";

export default function MobileVisionEvents() {
  const navigate = useNavigate();
  const { roles } = useAuth();
  const { projectId, applyCompanyFilter, scopeStatus } = useMobileAccess();
  const canManage = visionCanManage(roles);
  const [cameras, setCameras] = useState<MobileVisionCamera[]>([]);

  const load = async () => {
    if (!projectId) {
      setCameras([]);
      return;
    }
    if (scopeStatus !== "ready") return;
    let query = supabase
      .from("vision_cameras" as any)
      .select("id, camera_id, name, health_state, playback_url, company_id, created_at")
      .eq("project_id", projectId);
    query = applyCompanyFilter(query, { includeOrphans: true });
    const { data, error } = await query.order("created_at");
    if (error) toast.error(error.message);
    setCameras(sortVisionCamerasByRegistered((data || []) as MobileVisionCamera[]));
  };

  useEffect(() => {
    void load();
  }, [projectId, scopeStatus]);

  return (
    <div className="max-w-md mx-auto" data-testid="mobile-vision-events">
      <MobilePageHeader title="비전 관제" onBack={() => navigate("/app/worker/tasks")} />
      <main className="px-4 pb-8 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {canManage ? "설정은 PC 비전 관제에서 합니다." : "현장 화면입니다."}
          </p>
          <Badge variant="secondary">{visionRoleLabel(roles)}</Badge>
        </div>
        <MobileVisionPlayer cameras={cameras} />
      </main>
    </div>
  );
}
