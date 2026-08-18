import { describe, expect, it } from "vitest";
import { permitViewerPath, resolvePermitViewerBackPath } from "@/lib/permitViewerNav";

describe("permitViewerNav", () => {
  it("maps from=approvals back to the inbox", () => {
    expect(resolvePermitViewerBackPath("approvals")).toBe("/app/worker/approvals");
  });

  it("allows an in-shell worker path (결재 상세)", () => {
    expect(resolvePermitViewerBackPath("/app/worker/approvals/abc")).toBe(
      "/app/worker/approvals/abc",
    );
  });

  it("rejects empty and off-shell paths", () => {
    expect(resolvePermitViewerBackPath(null)).toBeNull();
    expect(resolvePermitViewerBackPath("")).toBeNull();
    expect(resolvePermitViewerBackPath("/app/admin/work-permits")).toBeNull();
    expect(resolvePermitViewerBackPath("https://evil.example/")).toBeNull();
  });

  it("builds 문서보기 URLs with from=", () => {
    expect(permitViewerPath("p1")).toBe("/app/worker/permits?id=p1");
    expect(permitViewerPath("p1", "approvals")).toBe(
      "/app/worker/permits?id=p1&from=approvals",
    );
    expect(permitViewerPath("p1", "/app/worker/approvals/a1")).toBe(
      "/app/worker/permits?id=p1&from=%2Fapp%2Fworker%2Fapprovals%2Fa1",
    );
  });
});
