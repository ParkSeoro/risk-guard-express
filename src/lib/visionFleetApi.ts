/** Isolated Vision Fleet client — talks only to vision-fleet edge function. */

const FN = "vision-fleet";

export function visionFleetFnPath(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${FN}${p.startsWith("/v1") ? p : `/v1${p}`}`;
}

export type VisionGrantAction = "live_substream" | "live_mainstream" | "playback" | "evidence.request";

export function visionGrantTtlMs(action: VisionGrantAction): number {
  if (action === "live_mainstream") return 3 * 60_000;
  return 5 * 60_000;
}

export function visionEventSirenAllowed(opts: {
  type?: string | null;
  severity?: string | null;
  alarmInterlockEnabled?: boolean;
}): boolean {
  if (opts.type === "vision_safety_event") return false;
  if (!opts.alarmInterlockEnabled) return false;
  return opts.severity === "critical";
}
