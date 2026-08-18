/**
 * Realtime invalidation for the 60s gps_calibration client cache (F-13).
 * Broadcast only — do not publish the whole projects table.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  clearGpsCalibrationCache,
  GPS_CAL_CHANGED_EVENT,
  gpsCalChannelName,
} from "@/lib/tracking/gpsCalibration";

type WatchEntry = { channel: ReturnType<typeof supabase.channel>; refs: number };

const watches = new Map<string, WatchEntry>();

export function watchGpsCalibrationInvalidation(projectId: string): () => void {
  if (!projectId) return () => {};
  let entry = watches.get(projectId);
  if (!entry) {
    const channel = supabase
      .channel(gpsCalChannelName(projectId))
      .on("broadcast", { event: GPS_CAL_CHANGED_EVENT }, () => {
        clearGpsCalibrationCache(projectId);
      })
      .subscribe();
    entry = { channel, refs: 0 };
    watches.set(projectId, entry);
  }
  entry.refs += 1;
  return () => {
    const cur = watches.get(projectId);
    if (!cur) return;
    cur.refs -= 1;
    if (cur.refs > 0) return;
    watches.delete(projectId);
    void supabase.removeChannel(cur.channel);
  };
}

/** Local bust + notify other devices (tracking workers). */
export async function notifyGpsCalibrationChanged(projectId: string): Promise<void> {
  clearGpsCalibrationCache(projectId);
  if (!projectId) return;
  const existing = watches.get(projectId);
  try {
    if (existing) {
      await existing.channel.send({
        type: "broadcast",
        event: GPS_CAL_CHANGED_EVENT,
        payload: { projectId },
      });
      return;
    }
    const channel = supabase.channel(gpsCalChannelName(projectId));
    await new Promise<void>((resolve, reject) => {
      const t = window.setTimeout(() => reject(new Error("timeout")), 4_000);
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          window.clearTimeout(t);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          window.clearTimeout(t);
          reject(new Error(status));
        }
      });
    });
    await channel.send({
      type: "broadcast",
      event: GPS_CAL_CHANGED_EVENT,
      payload: { projectId },
    });
    void supabase.removeChannel(channel);
  } catch (e) {
    if (import.meta.env.DEV) console.warn("[gps-cal] broadcast failed", e);
  }
}
