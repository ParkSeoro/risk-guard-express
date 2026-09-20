/** Mux live ingest for VIGI RTMP (not RTMPS). */

export const MUX_RTMP_SERVER = "rtmp://global-live.mux.com:5222/app";

export function muxHlsUrl(playbackId: string): string | null {
  const id = playbackId.trim();
  if (!id) return null;
  return `https://stream.mux.com/${id}.m3u8`;
}

export function muxCameraId(liveStreamId: string): string {
  return `mux_${liveStreamId}`;
}

export function muxLiveStreamId(cameraId: string | null | undefined): string | null {
  if (!cameraId || !cameraId.startsWith("mux_")) return null;
  const id = cameraId.slice(4).trim();
  return id || null;
}

export type VisionMuxIngest = {
  rtmp_url: string;
  stream_key: string;
  playback_url: string;
};
