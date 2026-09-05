/**
 * Android headless GPS → track-location (survives recents swipe).
 * No-op on web / iOS.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";
import { TRACK_BG_HEARTBEAT_MS } from "@/lib/tracking/trackPowerPolicy";
import { SITE_EXIT_MAX_ACCURACY_M, SITE_EXIT_STREAK, SITE_RESUME_POLL_MS } from "@/lib/tracking/siteTrackBounds";

type HeadlessTrackPlugin = {
  start: (opts: Record<string, unknown>) => Promise<{ ok?: boolean }>;
  arm: (opts: Record<string, unknown>) => Promise<{ ok?: boolean }>;
  stop: (opts?: { disarm?: boolean }) => Promise<{ ok?: boolean }>;
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
  /** Consecutive outside samples before low-power watch. Default matches SITE_EXIT_STREAK. */
  exitStreak?: number;
  maxAccuracyM?: number;
  resumePollMs?: number;
  skipFence?: boolean;
  suppressLastPosition?: boolean;
};

export function isHeadlessTrackAvailable(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

function headlessPayload(opts: HeadlessTrackStartOpts): Record<string, unknown> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  return {
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
    intervalMs: opts.intervalMs ?? TRACK_BG_HEARTBEAT_MS,
    exitStreak: opts.exitStreak ?? SITE_EXIT_STREAK,
    maxAccuracyM: opts.maxAccuracyM ?? SITE_EXIT_MAX_ACCURACY_M,
    resumePollMs: opts.resumePollMs ?? SITE_RESUME_POLL_MS,
    skipFence: opts.skipFence === true,
    suppressLastPosition: opts.suppressLastPosition === true,
    fenceLat: opts.fenceLat ?? undefined,
    fenceLng: opts.fenceLng ?? undefined,
    fenceRadiusM: opts.fenceRadiusM ?? undefined,
  };
}

export async function startHeadlessTrack(opts: HeadlessTrackStartOpts): Promise<boolean> {
  if (!isHeadlessTrackAvailable()) return false;
  try {
    await HeadlessTrack.start(headlessPayload(opts));
    return true;
  } catch (e) {
    if (import.meta.env.DEV) console.warn("[HeadlessTrack] start failed", e);
    return false;
  }
}

/** Write prefs only — no foreground GPS service (screen-on battery). */
export async function armHeadlessTrack(opts: HeadlessTrackStartOpts): Promise<boolean> {
  if (!isHeadlessTrackAvailable()) return false;
  try {
    await HeadlessTrack.arm(headlessPayload(opts));
    return true;
  } catch (e) {
    if (import.meta.env.DEV) console.warn("[HeadlessTrack] arm failed", e);
    return false;
  }
}

/**
 * Pause the foreground-service GPS listener.
 * Keep persisted tokens unless `disarm` (check-out / stop tracking) so a
 * recents-swipe can restart from onTaskRemoved without a fresh JS start.
 */
export async function stopHeadlessTrack(opts?: { disarm?: boolean }): Promise<void> {
  if (!isHeadlessTrackAvailable()) return;
  try {
    await HeadlessTrack.stop({ disarm: opts?.disarm === true });
  } catch {
    /* plugin missing on older APKs */
  }
}
