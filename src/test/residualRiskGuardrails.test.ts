import { describe, it, expect } from "vitest";
import { evaluateResidualHigh, residualHighThresholdMany } from "@/lib/residualRiskGuardrails";

describe("residualRiskGuardrails", () => {
  it("warns when too many residual 상", () => {
    const r = evaluateResidualHigh({ total: 20, highInitial: 8, highRemain: 10 });
    expect(r.level).toBe("warn_many");
    expect(r.thresholdMany).toBe(residualHighThresholdMany(20));
  });

  it("warns when zero residual 상 after initial 상", () => {
    const r = evaluateResidualHigh({ total: 12, highInitial: 3, highRemain: 0 });
    expect(r.level).toBe("warn_zero");
  });

  it("ok for a few residual 상", () => {
    const r = evaluateResidualHigh({ total: 20, highInitial: 5, highRemain: 3 });
    expect(r.level).toBe("ok");
  });
});
