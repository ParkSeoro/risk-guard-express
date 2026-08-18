/**
 * Android headless GPS → track-location (survives recents swipe).
 * No-op on web / iOS.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

type HeadlessTrackPlugin = {
  start: (opts: Record<string, unknown>) => Promise<{ ok?: boolean }>;
  stop: () => Promise<{ ok?: boolean }>;
};

const HeadlessTrack = registerPlugin<HeadlessTrackPlugin>("HeadlessTrack");

export type HeadlessTrackStartOpts = {
  projectId: string;
  workerId?: string | null;
  workerName?: string | null;
  workerPhone?: string | null;
  companyId?: string | null;
  workerRole?: string | null;
  accessToken: string;
  refreshToken?: string | null;
  fenceLat?: number | null;
  fenceLng?: number | null;
  fenceRadiusM?: number | null;
  intervalMs?: number;
};

export function isHeadlessTrackAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export async function startHeadlessTrack(opts: HeadlessTrackStartOpts): Promise<boolean> {
  if (!isHeadlessTrackAvailable()) return false;
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  try {
    await HeadlessTrack.start({
      supabaseUrl,
      anonKey,
      accessToken: opts.accessToken,
      refreshToken: opts.refreshToken || "",
      projectId: opts.projectId,
      workerId: opts.workerId || "",
      workerName: opts.workerName || "",
      workerPhone: opts.workerPhone || "",
      companyId: opts.companyId || "",
      workerRole: opts.workerRole || "",
      intervalMs: opts.intervalMs ?? 45_000,
      fenceLat: opts.fenceLat ?? undefined,
      fenceLng: opts.fenceLng ?? undefined,
      fenceRadiusM: opts.fenceRadiusM ?? undefined,
    });
    return true;
  } catch (e) {
    if (import.meta.env.DEV) console.warn("[HeadlessTrack] start failed", e);
    return false;
  }
}

export async function stopHeadlessTrack(): Promise<void> {
  if (!isHeadlessTrackAvailable()) return;
  try {
    await HeadlessTrack.stop();
  } catch {
    /* plugin missing on older APKs */
  }
}
