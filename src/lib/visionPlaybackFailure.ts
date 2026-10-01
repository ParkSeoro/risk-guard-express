export type VisionOfflineCopy = { title: string; detail: string };

export const VISION_OFFLINE = {
  relay: {
    title: "중계 서버에 연결하지 못했습니다",
    detail: "인터넷 연결을 확인해 주세요",
  },
  camera: {
    title: "카메라가 서버에 연결되어 있지 않습니다",
    detail: "전원, 배터리, 4G 중 하나일 수 있습니다",
  },
  reconnecting: {
    title: "절약을 위해 송출이 멈춰 있었습니다",
    detail: "카메라가 다시 연결되는 중입니다",
  },
  ended: {
    title: "카메라 연결이 끊겼습니다",
    detail: "다시 시도를 눌러 주세요",
  },
  picture: {
    title: "서버에는 연결되어 있는데 화면이 열리지 않습니다",
    detail: "잠시 후 다시 시도해 주세요",
  },
} as const;

export type PlaylistClass = "relay" | "camera" | "ended" | "starting";

export function visionViewerStatusUrl(playbackUrl: string): string | null {
  if (!/\/index\.m3u8(\?|$)/i.test(playbackUrl)) return null;
  return playbackUrl.replace(/index\.m3u8(\?.*)?$/i, "viewer-status");
}

/** What the playlist itself can prove. A missing list is not a battery reading. */
export function classifyPlaylist(status: number | null, body: string, networkError: boolean): PlaylistClass {
  if (networkError || status == null || status >= 500) return "relay";
  if (status === 404 || status === 400) return "camera";
  if (status !== 200) return "relay";
  if (/#EXT-X-ENDLIST/i.test(body)) return "ended";
  if (/#EXTINF:/i.test(body) || /\.ts(\?|$)/i.test(body) || /\.m4s(\?|$)/i.test(body)) return "starting";
  return "camera";
}

export async function explainVisionPlayback(
  playbackUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<VisionOfflineCopy | "starting"> {
  const statusUrl = visionViewerStatusUrl(playbackUrl);
  if (statusUrl) {
    try {
      const status = await fetchImpl(statusUrl, { cache: "no-store" });
      if (status.ok) {
        const data = (await status.json()) as { idle_kick?: unknown };
        if (data?.idle_kick === true) return VISION_OFFLINE.reconnecting;
      }
    } catch {
      /* The relay status route is optional until that server is updated. */
    }
  }
  try {
    const res = await fetchImpl(playbackUrl, { cache: "no-store" });
    const body = res.ok ? await res.text() : "";
    const kind = classifyPlaylist(res.status, body, false);
    if (kind === "starting") return "starting";
    return VISION_OFFLINE[kind];
  } catch {
    return VISION_OFFLINE.relay;
  }
}
