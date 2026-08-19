/**
 * Vite hashed chunks 404 after a deploy while a tab still holds the old JS.
 * Dynamic import() then throws "Failed to fetch dynamically imported module".
 */

const STALE_CHUNK_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading chunk [\w.-]+ failed|Unable to preload CSS/i;

export const STALE_CHUNK_USER_MESSAGE =
  '화면이 이전 버전입니다. 페이지를 새로고침한 뒤 [초안 생성]을 다시 눌러 주세요.';

export const STALE_CHUNK_PAGE_MESSAGE =
  '화면이 이전 버전입니다. 페이지를 새로고침해 주세요.';

const RELOAD_KEY = 'safenex.stale-chunk-reload';
export const STALE_CHUNK_RELOAD_COOLDOWN_MS = 15_000;

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message || '';
  return String(err ?? '');
}

export function isStaleChunkError(err: unknown): boolean {
  return STALE_CHUNK_RE.test(errorMessage(err));
}

/** User-facing auto-gen failure. Maps Vite stale-chunk fetch errors to a refresh hint. */
export function formatAutoGenError(err: unknown): string {
  if (isStaleChunkError(err)) return STALE_CHUNK_USER_MESSAGE;
  const msg = errorMessage(err).trim();
  return msg || '자동 생성 실패';
}

export function shouldReloadForStaleChunk(lastReloadAt: number, now: number): boolean {
  if (!Number.isFinite(lastReloadAt) || lastReloadAt <= 0) return true;
  return now - lastReloadAt >= STALE_CHUNK_RELOAD_COOLDOWN_MS;
}

/** One guarded full reload when Vite fails to preload a lazy chunk. */
export function installStaleChunkAutoReload(win: Window = window): () => void {
  const onPreload = (event: Event) => {
    try {
      event.preventDefault();
    } catch {
      /* ignore */
    }
    try {
      const last = Number(win.sessionStorage?.getItem(RELOAD_KEY) || '0');
      const now = Date.now();
      if (!shouldReloadForStaleChunk(last, now)) return;
      win.sessionStorage?.setItem(RELOAD_KEY, String(now));
      win.location.reload();
    } catch {
      /* private mode / missing storage */
    }
  };
  win.addEventListener('vite:preloadError', onPreload);
  return () => win.removeEventListener('vite:preloadError', onPreload);
}
