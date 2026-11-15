import { describe, expect, it } from "vitest";
import { isManagerMobileRole } from "@/lib/mobileShell";
import { tbmListQueryBlock } from "@/lib/tbmListQuery";

describe("tbmListQueryBlock", () => {
  it("waits while company scope is still pending", () => {
    expect(tbmListQueryBlock({ projectId: "p1", scopeStatus: "pending" })).toBe("scope-pending");
    expect(tbmListQueryBlock({ projectId: "p1", scopeStatus: "ready" })).toBeNull();
    expect(tbmListQueryBlock({ projectId: "", scopeStatus: "ready" })).toBe("no-project");
  });

  it("keeps the unloaded viewer role on the worker shell", () => {
    expect(isManagerMobileRole("viewer")).toBe(false);
    expect(isManagerMobileRole("safety_manager")).toBe(true);
    expect(isManagerMobileRole("worker")).toBe(false);
  });
});
