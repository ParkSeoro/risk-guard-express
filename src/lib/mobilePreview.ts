/**
 * Master PC mobile preview — URL + sessionStorage (iframe-safe).
 * Nested MemoryRouter is forbidden under BrowserRouter; preview loads
 * /app/worker/* inside an iframe instead.
 */

export type PreviewMode =
  | "worker"
  | "supervisor"
  | "site_supervisor"
  | "site_manager"
  | "project_admin"
  | "safety_manager"
  | "master";

export const MOBILE_PREVIEW_STORAGE_KEY = "safenex_mobile_preview";
export const MOBILE_PREVIEW_BLOCKED_MSG_TYPE = "mobile-preview:blocked-write";

export const PREVIEW_MODES: PreviewMode[] = [
  "worker",
  "supervisor",
  "site_supervisor",
  "site_manager",
  "project_admin",
  "safety_manager",
  "master",
];

export type MobilePreviewSession = {
  mode: PreviewMode;
  projectId: string;
};

export function parsePreviewMode(raw: string | null | undefined): PreviewMode {
  if (raw && (PREVIEW_MODES as string[]).includes(raw)) return raw as PreviewMode;
  return "worker";
}

export function readMobilePreviewSession(): MobilePreviewSession | null {
  try {
    const raw = sessionStorage.getItem(MOBILE_PREVIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MobilePreviewSession>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      mode: parsePreviewMode(parsed.mode),
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : "",
    };
  } catch {
    return null;
  }
}

export function writeMobilePreviewSession(session: MobilePreviewSession): void {
  try {
    sessionStorage.setItem(MOBILE_PREVIEW_STORAGE_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
}

export function clearMobilePreviewSession(): void {
  try {
    sessionStorage.removeItem(MOBILE_PREVIEW_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function isInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

/** Sync from ?mobilePreview=1&previewRole=&previewProject= and/or iframe session. */
export function resolveMobilePreviewSession(search: string): MobilePreviewSession | null {
  const q = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(q);
  if (params.get("mobilePreview") === "1") {
    const session: MobilePreviewSession = {
      mode: parsePreviewMode(params.get("previewRole")),
      projectId: params.get("previewProject") || "",
    };
    writeMobilePreviewSession(session);
    return session;
  }
  if (isInIframe()) return readMobilePreviewSession();
  return null;
}

/**
 * AuthGuard: allow master on desktop worker shell when preview is active.
 * Side effect: persists session when URL flag is present (survives in-iframe nav).
 */
export function isActiveMobilePreviewRequest(search: string): boolean {
  return resolveMobilePreviewSession(search) != null;
}

export function buildMobilePreviewSrc(opts: {
  mode: PreviewMode;
  projectId: string;
  path?: string;
}): string {
  const path = opts.path || "/app/worker/today";
  const params = new URLSearchParams({
    mobilePreview: "1",
    previewRole: opts.mode,
    previewProject: opts.projectId,
  });
  return `${path}?${params.toString()}`;
}

export function notifyPreviewWriteBlocked(message: string): void {
  try {
    window.dispatchEvent(
      new CustomEvent("mobile-preview:blocked-write", { detail: { message } }),
    );
  } catch {
    /* ignore */
  }
  try {
    if (isInIframe() && window.parent) {
      window.parent.postMessage(
        { type: MOBILE_PREVIEW_BLOCKED_MSG_TYPE, message },
        window.location.origin,
      );
    }
  } catch {
    /* ignore */
  }
}
