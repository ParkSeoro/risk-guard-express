import { supabase } from "@/integrations/supabase/client";
import { softDeletePayload } from "@/lib/dataAccess";

const retiredThisSession = new Set<string>();

/**
 * Unified site-control map writes `restricted_zones`. Legacy Site Maps
 * (`site_zones` danger/restricted + geo_polygon) still matched in
 * track-location and kept firing 위험구역 진입 after the new map deleted
 * the live fence. Soft-delete those leftover GPS fences once per project.
 */
export async function retireLegacySiteDangerZones(projectId: string | null | undefined) {
  if (!projectId || retiredThisSession.has(projectId)) return;
  try {
    const uid = (await supabase.auth.getUser()).data.user?.id || "";
    const payload = uid
      ? softDeletePayload(uid, "통합 관제맵 위험구역 SSOT")
      : {
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          deleted_reason: "통합 관제맵 위험구역 SSOT",
        };
    const { error } = await supabase
      .from("site_zones")
      .update(payload as any)
      .eq("project_id", projectId)
      .eq("is_deleted", false)
      .in("zone_type", ["danger", "restricted"]);
    if (error) {
      console.warn("[retireLegacySiteDangerZones]", error.message);
      return;
    }
    retiredThisSession.add(projectId);
  } catch (e) {
    console.warn("[retireLegacySiteDangerZones]", e);
  }
}
