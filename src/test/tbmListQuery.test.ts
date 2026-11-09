import { describe, expect, it } from "vitest";
import { isManagerMobileRole } from "@/lib/mobileShell";
import { tbmListQueryBlock } from "@/lib/tbmListQuery";

describe("tbmListQueryBlock", () => {
  it("waits while company scope is still pending", () => {
    expect(tbmListQueryBlock({ projectId: "p1", scopeStatus: "pending" })).toBe("scope-pending");
    expect(tbmListQueryBlock({ projectId: "p1", scopeStatus: "ready" })).toBeNull();
    expect(tbmListQueryBlock({ projectId: "", scopeStatus: "ready" })).toBe("no-project");
  });

  it("does not treat the default mobile role change as a new list load", () => {
    expect(isManagerMobileRole("viewer")).toBe(true);
    expect(isManagerMobileRole("safety_manager")).toBe(true);
    expect(isManagerMobileRole("worker")).toBe(false);
  });
});
