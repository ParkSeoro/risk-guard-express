import { describe, it, expect } from "vitest";
import { notifyInspectionFailSummary } from "@/lib/inspectionFailNotify";

describe("inspectionFailNotify", () => {
  it("skips sending when there are no remaining fail labels", async () => {
    await expect(
      notifyInspectionFailSummary({
        projectId: "p1",
        inspectionId: "i1",
        location: "현장",
        failLabels: ["  ", ""],
      }),
    ).resolves.toBeUndefined();
  });
});
