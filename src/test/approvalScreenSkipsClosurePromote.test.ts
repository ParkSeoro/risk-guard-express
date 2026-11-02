import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const screens = ["src/pages/Approvals.tsx", "src/pages/MobileApprovals.tsx"];

describe("approval screens do not scan permits on open", () => {
  it("leaves closure promotion and stuck-step repair to the morning cron", () => {
    for (const path of screens) {
      const body = readFileSync(path, "utf8");
      expect(body).not.toContain("promote_permits_to_closure_pending");
      expect(body).not.toContain("repair_stuck_permit_closure_sm");
      expect(body).toContain("get_my_pending_entity_approvals");
    }
  });
});
