import { describe, expect, it } from "vitest";
import { toMobileShellPath } from "@/lib/notificationRoutes";

describe("mobile field announcements routes", () => {
  it("maps admin announcements path to mobile announcements list", () => {
    expect(toMobileShellPath("/app/admin/announcements")).toBe("/app/worker/announcements");
    expect(toMobileShellPath("/announcements")).toBe("/app/worker/announcements");
  });
});
