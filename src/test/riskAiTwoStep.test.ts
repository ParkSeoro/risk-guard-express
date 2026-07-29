import { describe, it, expect, vi } from "vitest";
import {
  isAiPendingRiskItem,
  isAiFailedRiskItem,
  AI_PENDING_HAZARD,
  AI_ROW_FAILED_HAZARD,
  mapPool,
  withRetry,
  RISK_ROW_MAX_ATTEMPTS,
  RISK_ROW_CONCURRENCY,
} from "@/lib/riskAutoGenAI";

describe("two-step risk AI helpers", () => {
  it("detects pending placeholder rows", () => {
    expect(isAiPendingRiskItem({ hazard: AI_PENDING_HAZARD })).toBe(true);
    expect(isAiPendingRiskItem({ hazard: "추락", note: "[AI_PENDING]" })).toBe(true);
    expect(isAiPendingRiskItem({ hazard: "추락" })).toBe(false);
  });

  it("detects failed rows for retry UI", () => {
    expect(isAiFailedRiskItem({ hazard: AI_ROW_FAILED_HAZARD })).toBe(true);
    expect(isAiFailedRiskItem({ note: "[AI_ROW_FAILED] rate limit" })).toBe(true);
    expect(isAiFailedRiskItem({ hazard: "추락" })).toBe(false);
  });

  it("caps concurrency at 2 by default constant", () => {
    expect(RISK_ROW_CONCURRENCY).toBeLessThanOrEqual(3);
    expect(RISK_ROW_CONCURRENCY).toBeGreaterThanOrEqual(2);
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

  it("withRetry retries up to 3 attempts then succeeds", async () => {
    let n = 0;
    const result = await withRetry(async () => {
      n += 1;
      if (n < 3) throw new Error("RATE_LIMIT 429");
      return "ok";
    }, { attempts: RISK_ROW_MAX_ATTEMPTS });
    expect(result).toBe("ok");
    expect(n).toBe(3);
  });

  it("withRetry stops after max attempts", async () => {
    let n = 0;
    await expect(
      withRetry(async () => {
        n += 1;
        throw new Error("TIMEOUT");
      }, { attempts: 3 }),
    ).rejects.toThrow(/TIMEOUT/);
    expect(n).toBe(3);
  });
});
