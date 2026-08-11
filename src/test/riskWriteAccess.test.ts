import { describe, it, expect } from "vitest";
import {
  RISK_ITEM_WRITE_ROLES,
  canWriteRiskItems,
  riskItemsWriteDeniedMessage,
} from "@/lib/riskWriteAccess";

describe("riskWriteAccess SSOT", () => {
  it("includes site_supervisor and excludes supervisor(감리)", () => {
    expect(RISK_ITEM_WRITE_ROLES).toContain("site_supervisor");
    expect(RISK_ITEM_WRITE_ROLES as readonly string[]).not.toContain("supervisor");
    expect(canWriteRiskItems("site_supervisor")).toBe(true);
    expect(canWriteRiskItems("supervisor")).toBe(false);
    expect(canWriteRiskItems("project_admin")).toBe(true);
    expect(canWriteRiskItems("worker")).toBe(false);
  });

  it("denied message names site_supervisor and current role", () => {
    const msg = riskItemsWriteDeniedMessage("site_supervisor");
    expect(msg).toMatch(/site_supervisor\(관리감독자\)/);
    expect(msg).toMatch(/현재 역할: site_supervisor/);
  });
});
