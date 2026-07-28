import { supabase } from "@/integrations/supabase/client";
import { speakDangerAlert, DANGER_MESSAGE } from "@/lib/tts";

/**
 * Master-only alarm simulator: skip GPS, force full alert cycle.
 * - Local: TTS + caller shows fullscreen modal
 * - Server: insert unauthorized_entry → trg_zone_event_notify → FCM push to safety managers
 */
export async function simulateDangerZoneAlert(opts: {
  projectId: string;
  workerName?: string | null;
  zoneName?: string | null;
}): Promise<{ ok: boolean; error?: string; eventId?: string }> {
  const displayName = opts.workerName?.trim() || "테스트 근로자(마스터)";
  const zoneLabel = opts.zoneName?.trim() || "시뮬레이션 위험구역";

  // Always fire local TTS immediately (user-gesture → speechSynthesis allowed)
  speakDangerAlert(DANGER_MESSAGE);

  try {
    const { data, error } = await supabase
      .from("worker_zone_events")
      .insert({
        project_id: opts.projectId,
        zone_id: null,
        restricted_zone_id: null,
        worker_name: displayName,
        worker_phone: null,
        worker_qr_id: null,
        event_type: "unauthorized_entry",
        source: "alarm_sim",
        notes: `[ALARM_SIM] ${zoneLabel}`,
        lat: null,
        lng: null,
      } as any)
      .select("id")
      .single();

    if (error) {
      // Fallback: direct notification to current user so push path still demonstrable
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (uid) {
        await supabase.from("notifications").insert({
          user_id: uid,
          project_id: opts.projectId,
          type: "danger_zone_entry",
          title: `🚨 긴급: ${displayName} 근로자 위험 구역 진입`,
          message: `${displayName} 근로자가 ${zoneLabel}에 진입했습니다. (시뮬레이션)`,
          body: `${displayName} 근로자가 ${zoneLabel}에 진입했습니다. (시뮬레이션)`,
          related_type: "zone_event",
          related_id: null,
          link: `/zone-events?project=${opts.projectId}`,
          severity: "high",
          is_read: false,
        } as any);
      }
      return { ok: true, error: error.message };
    }

    return { ok: true, eventId: data?.id };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}
