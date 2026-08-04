/**
 * Geofence danger alarm for the formal /app/worker shell.
 * Uses GPS already started by WorkerGlobalGps (no second tracker).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { useSystemRealtime } from "@/providers/SystemRealtimeProvider";
import { supabase } from "@/integrations/supabase/client";
import {
  findViolatingRestrictedZone,
  type RestrictedZoneGeom,
} from "@/lib/tracking/restrictedZoneGeom";
import DangerZoneAlertModal from "@/components/geofence/DangerZoneAlertModal";

function isEntryEventType(t: string): boolean {
  return /unauthorized|restricted|danger|ban/i.test(t) && !/exit|leave|depart/i.test(t);
}

function isExitEventType(t: string): boolean {
  return /^(exit|leave|depart)/i.test(t) || /_exit$/i.test(t);
}

export default function ShellGeofenceAlerts() {
  const { profile } = useAuth();
  const { projectId, role } = useMobileAccess();
  const { lastGpsFix, lastZoneEvent } = useSystemRealtime();
  const [alertZone, setAlertZone] = useState<{ id: string; name: string } | null>(null);
  const zonesRef = useRef<RestrictedZoneGeom[]>([]);
  const lastAlertAt = useRef(0);
  const activeZoneId = useRef<string | null>(null);

  const loadZones = useCallback(async () => {
    if (!projectId) {
      zonesRef.current = [];
      return;
    }
    const { data } = await supabase
      .from("restricted_zones")
      .select(
        "id, name, geometry_type, geo_polygon, center_lat, center_lng, radius_m, banned_worker_ids, banned_company_ids, banned_job_types, access_rules, rule_type, zone_category, zone_color, is_active",
      )
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .eq("is_active", true);
    zonesRef.current = (data || []) as unknown as RestrictedZoneGeom[];
    // Drop sticky modal if the active zone was deleted / deactivated
    setAlertZone((prev) => {
      if (!prev) return prev;
      if (prev.id === "zone") return null;
      const still = zonesRef.current.some((z) => z.id === prev.id);
      return still ? prev : null;
    });
    if (activeZoneId.current && !zonesRef.current.some((z) => z.id === activeZoneId.current)) {
      activeZoneId.current = null;
    }
  }, [projectId]);

  useEffect(() => {
    void loadZones();
  }, [loadZones]);

  // Keep zone list fresh when master edits/deletes restricted zones
  useEffect(() => {
    if (!projectId) return;
    const channel = supabase
      .channel(`shell-rz-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "restricted_zones", filter: `project_id=eq.${projectId}` },
        () => {
          void loadZones();
        },
      )
      .subscribe();
    const poll = window.setInterval(() => {
      void loadZones();
    }, 60_000);
    return () => {
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [projectId, loadZones]);

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
      // Left all restricted zones — clear sticky alarm
      activeZoneId.current = null;
      setAlertZone((prev) => (prev ? null : prev));
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
    const t = String((lastZoneEvent as { event_type?: string }).event_type || "");
    const zoneId =
      (lastZoneEvent as { restricted_zone_id?: string; zone_id?: string }).restricted_zone_id ||
      (lastZoneEvent as { zone_id?: string }).zone_id ||
      null;

    if (isExitEventType(t)) {
      activeZoneId.current = null;
      setAlertZone(null);
      return;
    }

    // Only ENTRY-class events open the modal. Exit rows still carry restricted_zone_id.
    if (!isEntryEventType(t)) return;

    setAlertZone({
      id: zoneId || "zone",
      name: (lastZoneEvent as { zone_name?: string }).zone_name || "위험 구역",
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
