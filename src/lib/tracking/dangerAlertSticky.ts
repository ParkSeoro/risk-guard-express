/**
 * Sticky danger-zone alert helpers (persist across screen lock / WebView pause).
 */
const KEY = "safenex-danger-alert-v1";

export type StickyDangerAlert = {
  projectId: string;
  zoneId: string;
  zoneName: string;
  at: number;
};

export function saveStickyDangerAlert(alert: StickyDangerAlert) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(alert));
  } catch {
    /* ignore */
  }
}

export function loadStickyDangerAlert(projectId: string | null | undefined): StickyDangerAlert | null {
  if (!projectId) return null;
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as StickyDangerAlert;
    if (!o || o.projectId !== projectId) return null;
    // Expire after 2h — avoid zombie banners next day
    if (Date.now() - (o.at || 0) > 2 * 60 * 60_000) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

export function clearStickyDangerAlert() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** Placeholder ids used when a server event has no live zone UUID. */
export function isPlaceholderZoneId(zoneId: string | null | undefined): boolean {
  return !zoneId || zoneId === "zone" || zoneId === "unknown";
}

export function isLiveRestrictedZoneId(
  zoneId: string | null | undefined,
  zones: Array<{ id: string }>,
): boolean {
  if (isPlaceholderZoneId(zoneId)) return false;
  return zones.some((z) => z.id === zoneId);
}

/**
 * Sticky banners must not reopen after the zone was deleted/moved.
 * Require the zone to still exist AND current GPS to still be inside it.
 */
export function shouldRestoreStickyDangerAlert(opts: {
  sticky: StickyDangerAlert | null;
  liveZones: Array<{ id: string }>;
  gpsInsideZoneId: string | null | undefined;
}): boolean {
  if (!opts.sticky) return false;
  if (!isLiveRestrictedZoneId(opts.sticky.zoneId, opts.liveZones)) return false;
  return opts.gpsInsideZoneId === opts.sticky.zoneId;
}

/** Best-effort OS banner when WebView cannot paint (screen off). */
export async function notifyDangerZoneOs(zoneName: string) {
  try {
    if (typeof Notification === "undefined") return;
    if (Notification.permission !== "granted") return;
    const n = new Notification("위험 구역 진입", {
      body: `${zoneName || "제한구역"}에 진입했습니다. 즉시 이탈하십시오. 화면을 켜면 경고가 다시 표시됩니다.`,
      tag: "safenex-danger-zone",
      renotify: true,
      requireInteraction: true,
      silent: false,
    } as NotificationOptions);
    n.onclick = () => {
      try {
        window.focus();
      } catch {
        /* ignore */
      }
      n.close();
    };
  } catch {
    /* ignore — native may lack Notification API */
  }
}
