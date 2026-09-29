/** VPS MediaMTX ingest for VIGI RTMP (not RTMPS). HLS is HTTPS. */

export type VisionVpsRelay = {
  host: string;
  rtmp_url: string;
  hls_base: string;
};

export type VisionVpsIngest = {
  rtmp_url: string;
  stream_key: string;
  playback_url: string;
};

export function visionVpsHost(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.username || parsed.password) return null;
    const host = parsed.hostname.trim().toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

export function visionVpsIsIpv4(host: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
}

export function visionVpsHlsHost(host: string): string {
  if (visionVpsIsIpv4(host)) return `${host.replace(/\./g, "-")}.sslip.io`;
  return host;
}

export function visionVpsRtmpUrl(host: string): string {
  return `rtmp://${host}:1935/live`;
}

export function visionVpsHlsBase(host: string): string {
  return `https://${visionVpsHlsHost(host)}`;
}

export function visionVpsFromHost(raw: string): VisionVpsRelay | null {
  const host = visionVpsHost(raw);
  if (!host) return null;
  return { host, rtmp_url: visionVpsRtmpUrl(host), hls_base: visionVpsHlsBase(host) };
}

export function visionVpsCameraId(streamKey: string): string {
  return `vps_${streamKey}`;
}

export function visionVpsStreamKey(cameraId: string | null | undefined): string | null {
  if (!cameraId || !cameraId.startsWith("vps_")) return null;
  const key = cameraId.slice(4).trim();
  return key || null;
}

export function visionVpsPlaybackUrl(hlsBase: string, streamKey: string): string {
  return `${hlsBase.replace(/\/+$/, "")}/live/${streamKey}/index.m3u8`;
}
