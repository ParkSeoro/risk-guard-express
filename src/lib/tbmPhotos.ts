/** Session-level TBM 실시 사진 (meeting shots, not per-worker). */

export const TBM_MAX_PHOTOS = 3;

export function parseTbmPhotoUrls(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((u) => String(u || "").trim())
      .filter(Boolean)
      .slice(0, TBM_MAX_PHOTOS);
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return [];
    if (s.startsWith("[")) {
      try {
        return parseTbmPhotoUrls(JSON.parse(s));
      } catch {
        return [];
      }
    }
    if (/^https?:\/\//i.test(s)) return [s];
  }
  return [];
}

export function tbmPhotoCountLabel(urls: string[]): string {
  const n = urls.length;
  if (n <= 0) return "";
  return `실시 사진 ${n}/${TBM_MAX_PHOTOS}`;
}
