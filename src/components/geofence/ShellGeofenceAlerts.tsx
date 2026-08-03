/**
 * Geofence danger alarm for the formal /app/worker shell.
 * Uses GPS already started by WorkerGlobalGps (no second tracker).
 */
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { useSystemRealtime } from "@/providers/SystemRealtimeProvider";
import { supabase } from "@/integrations/supabase/client";
import {
  findViolatingRestrictedZone,
  type RestrictedZoneGeom,
} from "@/lib/tracking/restrictedZoneGeom";
import DangerZoneAlertModal from "@/components/geofence/DangerZoneAlertModal";

export default function ShellGeofenceAlerts() {
  const { profile } = useAuth();
  const { projectId, role } = useMobileAccess();
  const { lastGpsFix, lastZoneEvent } = useSystemRealtime();
  const [alertZone, setAlertZone] = useState<{ id: string; name: string } | null>(null);
  const zonesRef = useRef<RestrictedZoneGeom[]>([]);
  const lastAlertAt = useRef(0);
  const activeZoneId = useRef<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      zonesRef.current = [];
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("restricted_zones")
        .select(
          "id, name, geometry_type, geo_polygon, center_lat, center_lng, radius_m, banned_worker_ids, banned_company_ids, banned_job_types, access_rules, rule_type, zone_category, zone_color, is_active",
        )
        .eq("project_id", projectId)
        .eq("is_deleted", false)
        .eq("is_active", true);
      if (!cancelled) zonesRef.current = (data || []) as unknown as RestrictedZoneGeom[];
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!lastGpsFix || !projectId) return;
    const sub = {
      worker_name: profile?.display_name || null,
      worker_phone: profile?.phone || null,
      worker_role: role || null,
    };
    const hit = findViolatingRestrictedZone(
      lastGpsFix.lat,
      lastGpsFix.lng,
      zonesRef.current,
      sub,
    );
    if (!hit) {
      activeZoneId.current = null;
      return;
    }
    const now = Date.now();
    if (activeZoneId.current === hit.id && now - lastAlertAt.current < 30_000) return;
    activeZoneId.current = hit.id;
    lastAlertAt.current = now;
    setAlertZone({ id: hit.id, name: hit.name });
  }, [lastGpsFix, projectId, profile?.display_name, profile?.phone, role]);

  useEffect(() => {
    if (!lastZoneEvent) return;
    const t = String((lastZoneEvent as any).event_type || "");
    if (!/unauthorized|restricted|danger|ban/i.test(t) && !(lastZoneEvent as any).restricted_zone_id) {
      return;
    }
    setAlertZone({
      id: (lastZoneEvent as any).restricted_zone_id || (lastZoneEvent as any).zone_id || "zone",
      name: (lastZoneEvent as any).zone_name || "위험 구역",
    });
  }, [lastZoneEvent]);

  return (
    <DangerZoneAlertModal
      open={!!alertZone}
      zoneName={alertZone?.name}
      workerName={profile?.display_name}
      workerRole={role}
      onDismiss={() => setAlertZone(null)}
    />
  );
}
