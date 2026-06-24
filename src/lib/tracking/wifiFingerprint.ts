// Wi-Fi fingerprint helpers.
// Wi-Fi scanning from the browser is impossible; we keep the math here so both
// the client (Capacitor / native plugin) and the edge function can share it.

export type WifiScanEntry = { bssid: string; rssi: number; ssid?: string };
export type WifiFingerprint = { bssid: string; avg_rssi: number; stddev?: number }[];

/** Cosine similarity between two RSSI vectors keyed by BSSID.
 *  RSSI is normalized into [0,1] using -100..-30 dBm range. */
export function cosineSimilarity(
  scan: WifiScanEntry[],
  fingerprint: WifiFingerprint
): number {
  if (!scan?.length || !fingerprint?.length) return 0;
  const norm = (rssi: number) => Math.max(0, Math.min(1, (rssi + 100) / 70));

  const scanMap = new Map<string, number>();
  for (const s of scan) scanMap.set(s.bssid.toLowerCase(), norm(s.rssi));

  const fpMap = new Map<string, number>();
  for (const f of fingerprint) fpMap.set(f.bssid.toLowerCase(), norm(f.avg_rssi));

  const keys = new Set<string>([...scanMap.keys(), ...fpMap.keys()]);
  let dot = 0, sa = 0, sb = 0;
  for (const k of keys) {
    const a = scanMap.get(k) ?? 0;
    const b = fpMap.get(k) ?? 0;
    dot += a * b;
    sa += a * a;
    sb += b * b;
  }
  if (sa === 0 || sb === 0) return 0;
  return dot / Math.sqrt(sa * sb);
}

/** Pick the zone whose fingerprint best matches the live scan. */
export function matchZoneByWifi(
  scan: WifiScanEntry[],
  zones: { id: string; wifi_fingerprint: WifiFingerprint | null }[]
): { zoneId: string; score: number } | null {
  let best: { zoneId: string; score: number } | null = null;
  for (const z of zones) {
    if (!z.wifi_fingerprint?.length) continue;
    const score = cosineSimilarity(scan, z.wifi_fingerprint);
    if (!best || score > best.score) best = { zoneId: z.id, score };
  }
  // require minimum confidence
  return best && best.score >= 0.6 ? best : null;
}

/** Aggregate raw samples into a fingerprint (mean + stddev per BSSID). */
export function aggregateSamples(
  samples: { bssid: string; rssi: number }[]
): WifiFingerprint {
  const byBssid: Record<string, number[]> = {};
  for (const s of samples) (byBssid[s.bssid.toLowerCase()] ||= []).push(s.rssi);
  return Object.entries(byBssid).map(([bssid, vals]) => {
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance =
      vals.length > 1 ? vals.reduce((a, b) => a + (b - avg) ** 2, 0) / vals.length : 0;
    return { bssid, avg_rssi: Math.round(avg), stddev: Math.round(Math.sqrt(variance)) };
  });
}
