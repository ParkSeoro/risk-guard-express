import { describe, it, expect } from "vitest";
import { isAiPendingRiskItem, AI_PENDING_HAZARD, mapPool } from "@/lib/riskAutoGenAI";

describe("two-step risk AI helpers", () => {
  it("detects pending placeholder rows", () => {
    expect(isAiPendingRiskItem({ hazard: AI_PENDING_HAZARD })).toBe(true);
    expect(isAiPendingRiskItem({ hazard: "추락", note: "[AI_PENDING]" })).toBe(true);
    expect(isAiPendingRiskItem({ hazard: "추락" })).toBe(false);
  });

  it("mapPool respects concurrency and order", async () => {
    const seen: number[] = [];
    let active = 0;
    let maxActive = 0;
    const out = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      seen.push(n);
      active -= 1;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50]);
    expect(maxActive).toBeLessThanOrEqual(2);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
