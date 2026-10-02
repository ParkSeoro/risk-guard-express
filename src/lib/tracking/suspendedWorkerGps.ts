/**
 * Suspended workers cannot check in, so the normal "track only after 출근"
 * rule would hide them. They are tracked from the site fence instead.
 */

export type WorkerGpsStartMode = "checked_in" | "site_fence" | "stopped";

export function workerGpsStartMode(opts: {
  checkedIn: boolean;
  siteEntrySuspended: boolean;
}): WorkerGpsStartMode {
  if (opts.checkedIn) return "checked_in";
  if (opts.siteEntrySuspended) return "site_fence";
  return "stopped";
}
