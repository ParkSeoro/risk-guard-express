import { describe, expect, it } from "vitest";
import { dedupeProjectsById, projectsFromMembershipRows } from "@/lib/mobileProjects";

describe("mobileProjects", () => {
  it("dedupes repeated project ids", () => {
    const out = dedupeProjectsById([
      { id: "p1", name: "GSC" },
      { id: "p1", name: "GSC" },
      { id: "p2", name: "Other" },
      { id: "p1", name: "GSC again" },
    ]);
    expect(out).toEqual([
      { id: "p1", name: "GSC" },
      { id: "p2", name: "Other" },
    ]);
  });

  it("collapses membership fan-out to one option per project", () => {
    const out = projectsFromMembershipRows([
      { project_id: "p1", projects: { id: "p1", name: "GSC 여수 H2/LCO2 PJT" } },
      { project_id: "p1", projects: { id: "p1", name: "GSC 여수 H2/LCO2 PJT" } },
      { project_id: "p1", projects: { id: "p1", name: "GSC 여수 H2/LCO2 PJT" } },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toContain("GSC");
  });
});
