/**
 * Common archive URL resolver for SafeNex attachments (PR #684).
 *
 * - Active (< 60d) and backed-up (still in Supabase) files return the original URL immediately.
 * - Archived-purged files (moved to Google One) are transparently restored on demand
 *   into `archive-restore-cache` and served via a short-lived 5-minute Signed URL.
 * - Signed URLs are NEVER persisted into database rows; they live only in short-lived memory cache.
 */
import { supabase } from "@/integrations/supabase/client";

const ATTACHMENTS_PUBLIC_MARKER = "/storage/v1/object/public/attachments/";
const RESTORED_CACHE_TTL_MS = 240_000; // 4 min (< 5 min Signed URL TTL)
const ACTIVE_CACHE_TTL_MS = 60_000; // 1 min negative cache for non-purged paths

type CachedUrl = { url: string; expiresAt: number };

const restoredCache = new Map<string, CachedUrl>();
const activeCache = new Map<string, number>();
const inflightRestore = new Map<string, Promise<string>>();

let fallbackInstalled = false;

export function clearArchiveResolverCache(): void {
  restoredCache.clear();
  activeCache.clear();
  inflightRestore.clear();
}

/**
 * Extracts the `attachments` bucket object path from a Supabase public Storage URL.
 * Returns null for non-attachments URLs (blob:, data:, signed cache URLs, external hosts).
 */
export function extractAttachmentsObjectPath(rawUrl?: string | null): string | null {
  const s = String(rawUrl || "").trim();
  if (!s || s.startsWith("data:") || s.startsWith("blob:")) return null;
  const idx = s.indexOf(ATTACHMENTS_PUBLIC_MARKER);
  if (idx === -1) return null;
  const tail = s.slice(idx + ATTACHMENTS_PUBLIC_MARKER.length);
  const pathOnly = tail.split("?")[0].split("#")[0];
  if (!pathOnly) return null;
  try {
    return decodeURIComponent(pathOnly);
  } catch {
    return pathOnly;
  }
}

async function checkArchivedPaths(paths: string[]): Promise<Set<string>> {
  const now = Date.now();
  const toQuery: string[] = [];
  for (const p of paths) {
    const activeUntil = activeCache.get(p);
    if (activeUntil && activeUntil > now) continue;
    toQuery.push(p);
  }
  const unique = Array.from(new Set(toQuery));
  if (unique.length === 0) return new Set();

  try {
    const { data, error } = await (supabase as any).rpc("check_archived_storage_paths", {
      _paths: unique,
    });
    if (error || !Array.isArray(data)) return new Set();
    const archived = new Set<string>();
    for (const row of data as Array<{ object_path?: string; archive_status?: string }>) {
      if (row?.object_path && row.archive_status === "archived_purged") {
        archived.add(row.object_path);
      }
    }
    for (const p of unique) {
      if (!archived.has(p)) {
        activeCache.set(p, now + ACTIVE_CACHE_TTL_MS);
      }
    }
    return archived;
  } catch {
    return new Set();
  }
}

async function requestRestoredSignedUrl(
  objectPath: string,
  originalUrl: string,
  downloadFileName?: string | null,
): Promise<string> {
  const cacheKey = downloadFileName ? `${objectPath}::dl::${downloadFileName}` : objectPath;
  const now = Date.now();
  const hit = restoredCache.get(cacheKey);
  if (hit && hit.expiresAt > now) return hit.url;

  const existing = inflightRestore.get(cacheKey);
  if (existing) return existing;

  const task = (async () => {
    try {
      const { data, error } = await supabase.functions.invoke("restore-archived-attachment", {
        body: {
          bucket_id: "attachments",
          object_path: objectPath,
          file_name: downloadFileName || undefined,
        },
      });
      const restoredUrl = !error && typeof data?.url === "string" && data.url.trim()
        ? data.url.trim()
        : null;
      if (restoredUrl) {
        const ttlMs =
          typeof data?.expires_in === "number" && data.expires_in > 30
            ? Math.min(RESTORED_CACHE_TTL_MS, (data.expires_in - 30) * 1000)
            : RESTORED_CACHE_TTL_MS;
        restoredCache.set(cacheKey, { url: restoredUrl, expiresAt: Date.now() + ttlMs });
        return restoredUrl;
      }
      return originalUrl;
    } catch {
      return originalUrl;
    } finally {
      inflightRestore.delete(cacheKey);
    }
  })();

  inflightRestore.set(cacheKey, task);
  return task;
}

/**
 * Resolves a single Storage URL.
 * - If not archived-purged, returns `url` untouched.
 * - If archived-purged (or `forceRestore: true`), requests a short-lived Signed URL from Google One restore cache.
 */
export async function resolveArchivedUrl(
  url: string,
  opts?: { downloadFileName?: string | null; forceRestore?: boolean },
): Promise<string> {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  const objectPath = extractAttachmentsObjectPath(raw);
  if (!objectPath) return raw;

  const cacheKey = opts?.downloadFileName ? `${objectPath}::dl::${opts.downloadFileName}` : objectPath;
  const hit = restoredCache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.url;

  if (!opts?.forceRestore) {
    const archived = await checkArchivedPaths([objectPath]);
    if (!archived.has(objectPath)) return raw;
  }

  return requestRestoredSignedUrl(objectPath, raw, opts?.downloadFileName);
}

const ATTACHMENTS_URL_REGEX =
  /https?:\/\/[^\s"'<>()]+\/storage\/v1\/object\/public\/attachments\/[^\s"'<>()]+/g;

/**
 * Replaces any archived-purged `attachments` URLs inside an HTML document (for print / PDF export)
 * with live 5-minute Signed URLs in a single batched check.
 */
export async function resolveArchivedUrlsInHtml(html: string): Promise<string> {
  if (!html || !html.includes(ATTACHMENTS_PUBLIC_MARKER)) return html;

  const matches = html.match(ATTACHMENTS_URL_REGEX);
  if (!matches || matches.length === 0) return html;

  const uniqueUrls = Array.from(new Set(matches));
  const urlToPath = new Map<string, string>();
  for (const u of uniqueUrls) {
    const decoded = u.replace(/&amp;/g, "&");
    const path = extractAttachmentsObjectPath(decoded);
    if (path) urlToPath.set(u, path);
  }
  if (urlToPath.size === 0) return html;

  const archived = await checkArchivedPaths(Array.from(urlToPath.values()));
  if (archived.size === 0) return html;

  let out = html;
  const entries = Array.from(urlToPath.entries()).filter(([, p]) => archived.has(p));
  const resolvedPairs = await Promise.all(
    entries.map(async ([rawToken, path]) => {
      const cleanUrl = rawToken.replace(/&amp;/g, "&");
      const signed = await requestRestoredSignedUrl(path, cleanUrl);
      return [rawToken, signed] as const;
    }),
  );

  for (const [rawToken, signed] of resolvedPairs) {
    if (!signed || signed === rawToken) continue;
    const escapedForHtml = rawToken.includes("&amp;") ? signed.replace(/&/g, "&amp;") : signed;
    out = out.split(rawToken).join(escapedForHtml);
  }
  return out;
}

/**
 * Installs a zero-overhead global capture-phase <img> error fallback listener.
 * Active/backed-up images never trigger this; only an archived-purged 404 image
 * triggers a transparent on-demand restore from Google One.
 */
export function installArchivedImageFallback(): void {
  if (fallbackInstalled || typeof window === "undefined") return;
  fallbackInstalled = true;

  window.addEventListener(
    "error",
    (event) => {
      const target = event.target;
      if (!(target instanceof HTMLImageElement)) return;
      if (target.dataset.archiveRetried === "1") return;
      const src = target.currentSrc || target.getAttribute("src") || "";
      const path = extractAttachmentsObjectPath(src);
      if (!path) return;

      target.dataset.archiveRetried = "1";
      void resolveArchivedUrl(src, { forceRestore: true }).then((restored) => {
        if (restored && restored !== src && target.isConnected) {
          target.src = restored;
        }
      });
    },
    true,
  );
}
