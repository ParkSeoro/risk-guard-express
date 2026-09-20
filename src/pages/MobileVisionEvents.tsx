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
import { visionCanManage, visionRoleLabel } from "@/lib/visionFleetApi";

export default function MobileVisionEvents() {
  const navigate = useNavigate();
  const { roles } = useAuth();
  const { projectId } = useMobileAccess();
  const canManage = visionCanManage(roles);
  const [cameras, setCameras] = useState<MobileVisionCamera[]>([]);

  const load = async () => {
    if (!projectId) {
      setCameras([]);
      return;
    }
    const { data, error } = await supabase
      .from("vision_cameras" as any)
      .select("id, camera_id, name, health_state, playback_url")
      .eq("project_id", projectId)
      .order("name");
    if (error) toast.error(error.message);
    setCameras((data || []) as MobileVisionCamera[]);
  };

  useEffect(() => {
    void load();
  }, [projectId]);

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
