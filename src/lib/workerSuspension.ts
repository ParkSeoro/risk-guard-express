/** Worker site-entry suspension helpers (client). */

export type SuspensionKind = "1d" | "3d" | "permanent";

export const SUSPENSION_OPTIONS: { kind: SuspensionKind; label: string }[] = [
  { kind: "1d", label: "1일 정지" },
  { kind: "3d", label: "3일 정지" },
  { kind: "permanent", label: "영구 정지" },
];

export function suspensionKindLabel(kind: string | null | undefined): string {
  if (kind === "1d") return "1일";
  if (kind === "3d") return "3일";
  if (kind === "permanent") return "영구";
  return "정지";
}

export function isWorkerCurrentlySuspended(w: {
  site_entry_suspended_until?: string | null;
}): boolean {
  if (!w?.site_entry_suspended_until) return false;
  return new Date(w.site_entry_suspended_until).getTime() > Date.now();
}

export function formatSuspensionUntil(until: string | null | undefined, kind?: string | null): string {
  if (!until) return "";
  if (kind === "permanent" || until.startsWith("9999")) return "영구";
  try {
    return new Date(until).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  } catch {
    return until;
  }
}
