import { describe, it, expect } from "vitest";
import { filterDraftGaps, mapRiskItemRowToGenerated } from "@/lib/riskReuseFromPast";

describe("riskReuseFromPast", () => {
  it("filters AI draft gaps against reused sub_tasks", () => {
    const gaps = filterDraftGaps(
      [
        { sub_task: "굴착", hazard: "붕괴" },
        { sub_task: "되메우기", hazard: "협착" },
      ],
      [{ sub_task: "굴착", hazard: "붕괴" }],
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0].sub_task).toBe("되메우기");
  });

  it("maps DB rows to generated items", () => {
    const g = mapRiskItemRowToGenerated({
      process: "배관",
      sub_task: "용접",
      hazard: "화재",
      improved_risk_grade: "중",
      ppe: ["안전모"],
    });
    expect(g.process).toBe("배관");
    expect(g.ppe).toContain("안전모");
    expect(g.status).toBe("초안");
  });
});
