import { useState } from "react";
import { Button } from "@/components/ui/button";
import DangerZoneAlertModal from "@/components/geofence/DangerZoneAlertModal";
import { simulateDangerZoneAlert } from "@/lib/geofenceAlarmTest";
import { useAuth } from "@/contexts/AuthContext";
import { Siren, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Props = {
  projectId: string | null | undefined;
  /** Compact full-width mobile CTA */
  className?: string;
};

/**
 * Master-only control: force TTS + fullscreen alert + admin push cycle (no GPS).
 */
export default function MasterAlarmSimulator({ projectId, className }: Props) {
  const { profile, hasRole, roles } = useAuth();
  const isMaster = hasRole("master");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!isMaster) return null;

  // Prefer project-ish role for honorific; master wins for sim identity
  const effectiveRole =
    (roles || []).find((r) => r === "master") ||
    (roles || []).find((r) =>
      ["project_admin", "safety_manager", "site_manager", "supervisor", "site_supervisor", "worker"].includes(r),
    ) ||
    "master";

  const run = async () => {
    if (!projectId) {
      toast.error("프로젝트를 먼저 선택하세요");
      return;
    }
    setBusy(true);
    const r = await simulateDangerZoneAlert({
      projectId,
      workerName: profile?.display_name || "마스터(시뮬레이션)",
      workerRole: effectiveRole,
      zoneName: "알람 시뮬레이터 구역",
    });
    setBusy(false);
    setOpen(true);
    if (!r.ok) {
      toast.error("시뮬레이션 일부 실패: " + (r.error || ""));
    } else if (r.error) {
      toast.message("로컬 알람 실행 · 서버 이벤트: " + r.error);
    } else {
      toast.success("사이렌+육성 알람 + 관리자 푸시 사이클을 트리거했습니다");
    }
  };

  return (
    <>
      <DangerZoneAlertModal
        open={open}
        zoneName="알람 시뮬레이터 구역"
        workerName={profile?.display_name || "마스터"}
        workerRole={effectiveRole}
        onDismiss={() => setOpen(false)}
      />
      <Button
        type="button"
        variant="destructive"
        className={className || "w-full h-14 text-base font-bold"}
        onClick={run}
        disabled={busy}
      >
        {busy ? (
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
        ) : (
          <Siren className="h-5 w-5 mr-2" />
        )}
        육성/푸시 알람 테스트
      </Button>
    </>
  );
}
