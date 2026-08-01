import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildMobilePreviewSrc,
  clearMobilePreviewSession,
  isActiveMobilePreviewRequest,
  parsePreviewMode,
  readMobilePreviewSession,
  resolveMobilePreviewSession,
  writeMobilePreviewSession,
} from "@/lib/mobilePreview";

describe("mobilePreview session helpers", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("parses known preview roles and falls back to worker", () => {
    expect(parsePreviewMode("site_manager")).toBe("site_manager");
    expect(parsePreviewMode("nope")).toBe("worker");
    expect(parsePreviewMode(null)).toBe("worker");
  });

  it("builds iframe src with preview query params", () => {
    const src = buildMobilePreviewSrc({
      mode: "supervisor",
      projectId: "proj-1",
    });
    expect(src.startsWith("/app/worker/today?")).toBe(true);
    const q = new URLSearchParams(src.split("?")[1]);
    expect(q.get("mobilePreview")).toBe("1");
    expect(q.get("previewRole")).toBe("supervisor");
    expect(q.get("previewProject")).toBe("proj-1");
  });

  it("resolves session from URL and persists to sessionStorage", () => {
    const session = resolveMobilePreviewSession(
      "?mobilePreview=1&previewRole=project_admin&previewProject=abc",
    );
    expect(session).toEqual({ mode: "project_admin", projectId: "abc" });
    expect(readMobilePreviewSession()).toEqual(session);
    expect(isActiveMobilePreviewRequest("?mobilePreview=1&previewRole=worker&previewProject=x")).toBe(
      true,
    );
  });

  it("uses iframe sessionStorage when URL flag is absent", () => {
    writeMobilePreviewSession({ mode: "safety_manager", projectId: "p2" });
    vi.spyOn(window, "self", "get").mockReturnValue({} as any);
    vi.spyOn(window, "top", "get").mockReturnValue({} as any);
    // self !== top → in iframe
    expect(resolveMobilePreviewSession("")).toEqual({
      mode: "safety_manager",
      projectId: "p2",
    });
  });

  it("ignores sessionStorage outside iframe without URL flag", () => {
    writeMobilePreviewSession({ mode: "worker", projectId: "p3" });
    // default jsdom: self === top
    expect(resolveMobilePreviewSession("")).toBeNull();
    expect(isActiveMobilePreviewRequest("")).toBe(false);
    clearMobilePreviewSession();
    expect(readMobilePreviewSession()).toBeNull();
  });
});
