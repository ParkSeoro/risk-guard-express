import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mocks.rpc(...args),
    functions: {
      invoke: (...args: unknown[]) => mocks.invoke(...args),
    },
  },
}));

import {
  clearArchiveResolverCache,
  extractAttachmentsObjectPath,
  openArchivedUrl,
  resolveArchivedUrl,
  resolveArchivedUrlsInHtml,
} from "@/lib/archiveUrlResolver";

const BASE = "https://qhntxmggacorqjjmjqgo.supabase.co/storage/v1/object/public/attachments";

describe("archiveUrlResolver", () => {
  beforeEach(() => {
    clearArchiveResolverCache();
    mocks.rpc.mockReset();
    mocks.invoke.mockReset();
  });

  it("extracts object path from attachments public URL and ignores non-attachments URLs", () => {
    expect(extractAttachmentsObjectPath(`${BASE}/proj1/work-plans/p1/a%20b.pdf?download=1`)).toBe(
      "proj1/work-plans/p1/a b.pdf",
    );
    expect(extractAttachmentsObjectPath("data:image/png;base64,abc")).toBeNull();
    expect(extractAttachmentsObjectPath("https://example.com/foo.png")).toBeNull();
  });

  it("returns original URL immediately without invoking restore when file is active or backed_up", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const url = `${BASE}/proj1/tbm/photo.jpg`;
    const resolved = await resolveArchivedUrl(url);
    expect(resolved).toBe(url);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("restores archived_purged URL via restore-archived-attachment and caches signed URL", async () => {
    const path = "proj1/work-plans/p1/doc.pdf";
    const url = `${BASE}/${path}`;
    const signed = "https://qhntxmggacorqjjmjqgo.supabase.co/storage/v1/object/sign/archive-restore-cache/doc.pdf?token=xyz";
    mocks.rpc.mockResolvedValue({
      data: [{ object_path: path, archive_status: "archived_purged" }],
      error: null,
    });
    mocks.invoke.mockResolvedValue({
      data: { mode: "restored", url: signed, expires_in: 300 },
      error: null,
    });

    const first = await resolveArchivedUrl(url);
    const second = await resolveArchivedUrl(url);
    expect(first).toBe(signed);
    expect(second).toBe(signed);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("replaces archived_purged URLs inside HTML for print/PDF while keeping active URLs untouched", async () => {
    const archivedPath = "proj1/safety-inspection/old.jpg";
    const activePath = "proj1/safety-inspection/new.jpg";
    const signed = "https://signed.example/old.jpg?token=1&download=old.jpg";

    mocks.rpc.mockResolvedValue({
      data: [{ object_path: archivedPath, archive_status: "archived_purged" }],
      error: null,
    });
    mocks.invoke.mockResolvedValue({
      data: { mode: "restored", url: signed, expires_in: 300 },
      error: null,
    });

    const html = `<img src="${BASE}/${archivedPath}" /><img src="${BASE}/${activePath}" />`;
    const out = await resolveArchivedUrlsInHtml(html);
    expect(out).toContain(signed);
    expect(out).toContain(`${BASE}/${activePath}`);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it("openArchivedUrl pre-opens blank tab and navigates to restored Signed URL for archived files", async () => {
    const path = "safety-cost/proj1/rep1/doc.pdf";
    const url = `${BASE}/${path}`;
    const signed = "https://signed.example/doc.pdf?token=abc";
    const replaceSpy = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockReturnValue({
      closed: false,
      opener: window,
      location: { replace: replaceSpy },
    } as unknown as Window);

    mocks.rpc.mockResolvedValue({
      data: [{ object_path: path, archive_status: "archived_purged" }],
      error: null,
    });
    mocks.invoke.mockResolvedValue({
      data: { mode: "restored", url: signed, expires_in: 300 },
      error: null,
    });

    openArchivedUrl(url);
    await new Promise((r) => setTimeout(r, 10));
    expect(openSpy).toHaveBeenCalledWith("about:blank", "_blank");
    expect(replaceSpy).toHaveBeenCalledWith(signed);
    openSpy.mockRestore();
  });
});
