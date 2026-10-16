import { describe, expect, it } from "vitest";
import { mapAssessmentRunItemStats } from "@/lib/assessmentRunItemStats";

describe("mapAssessmentRunItemStats", () => {
  it("fills zeros for runs with no rows and maps RPC aggregates", () => {
    const mapped = mapAssessmentRunItemStats(
      ["a", "b", "c"],
      [
        { run_id: "a", total: 12, high: 2, med: 5, low: 5, residual: 1 },
        { run_id: "c", total: 0, high: 0, med: 0, low: 0, residual: 0 },
      ],
    );
    expect(mapped.a).toEqual({ total: 12, high: 2, med: 5, low: 5, residual: 1 });
    expect(mapped.b).toEqual({ total: 0, high: 0, med: 0, low: 0, residual: 0 });
    expect(mapped.c.total).toBe(0);
  });

  it("ignores unknown run ids from the server", () => {
    const mapped = mapAssessmentRunItemStats(["only"], [
      { run_id: "other", total: 99, high: 1, med: 1, low: 97, residual: 0 },
    ]);
    expect(mapped).toEqual({
      only: { total: 0, high: 0, med: 0, low: 0, residual: 0 },
    });
  });
});
