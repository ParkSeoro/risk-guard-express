import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toAdminUrl } from "@/lib/adminNav";
import {
  hasActiveAlarmingZones,
  NO_ACTIVE_DANGER_ZONE_MESSAGE,
} from "@/lib/tracking/activeAlarmZones";

type Status = "unknown" | "none" | "some";

type Props = {
  projectId: string | null | undefined;
  /** Bump after the parent reloads zones so the banner follows a save. */
  refreshKey?: string | number;
  /** False on the zone screen itself. */
  showManageLink?: boolean;
  /** Stay on this page (switch to the zones tab) instead of navigating. */
  onManage?: () => void;
};

/**
 * Read-only warning. Query failures hide the banner and never toast.
 * Does not block the page.
 */
export default function NoActiveDangerZoneBanner({
  projectId,
  refreshKey = 0,
  showManageLink = true,
  onManage,
}: Props) {
  const [status, setStatus] = useState<Status>("unknown");
  const seenProject = useRef(projectId);
  if (seenProject.current !== projectId) {
    seenProject.current = projectId;
    setStatus("unknown");
  }

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    try {
      void supabase
        .from("restricted_zones")
        .select("zone_category, is_active, is_deleted")
        .eq("project_id", projectId)
        .eq("is_deleted", false)
        .eq("is_active", true)
        .then(
          ({ data, error }) => {
            if (cancelled) return;
            if (error || !Array.isArray(data)) {
              setStatus("unknown");
              return;
            }
            setStatus(hasActiveAlarmingZones(data) ? "some" : "none");
          },
          () => {
            if (!cancelled) setStatus("unknown");
          },
        );
    } catch {
      if (!cancelled) setStatus("unknown");
    }
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  if (status !== "none") return null;

  return (
    <div
      role="status"
      data-testid="no-active-danger-zone-banner"
      className="flex flex-wrap items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950 leading-relaxed"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" aria-hidden />
      <p className="min-w-0 flex-1">{NO_ACTIVE_DANGER_ZONE_MESSAGE}</p>
      {showManageLink && onManage ? (
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={onManage}>
          위험구역 등록
        </Button>
      ) : null}
      {showManageLink && !onManage ? (
        <Button asChild size="sm" variant="outline" className="h-7 text-xs">
          <Link to={toAdminUrl("/site-control-map")}>위험구역 등록</Link>
        </Button>
      ) : null}
    </div>
  );
}
