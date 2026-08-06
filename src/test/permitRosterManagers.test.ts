import { describe, it, expect } from "vitest";
import { mergePermitRosterCandidates } from "@/lib/permitRosterManagers";
import type { PermitWorkerRow } from "@/lib/permitWorkers";

describe("mergePermitRosterCandidates", () => {
  it("merges managers onto field list and flags isManager", () => {
    const field: PermitWorkerRow[] = [
      { id: "w1", name: "김근로", phone: "01011112222" },
      { id: "w2", name: "이관리", phone: "01033334444" },
    ];
    const managers = [
      { id: "w2", name: "이관리", phone: "01033334444", isManager: true, managerRole: "safety_manager" },
      { id: "w3", name: "박소장", phone: "01055556666", isManager: true, managerRole: "site_manager" },
    ];
    const out = mergePermitRosterCandidates(field, managers);
    expect(out).toHaveLength(3);
    expect(out.find((x) => x.id === "w2")?.isManager).toBe(true);
    expect(out.find((x) => x.id === "w3")?.isManager).toBe(true);
    expect(out.find((x) => x.id === "w1")?.isManager).toBe(false);
    // managers sorted before field workers
    expect(out[0].isManager).toBe(true);
  });
});
