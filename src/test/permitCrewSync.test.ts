import { describe, it, expect } from "vitest";
import {
  EMPTY_ONSITE_CREW_GUARD,
  EMPTY_TBM_CREW_GUARD,
  shouldRefuseEmptyCrewReplace,
} from "@/lib/permitCrewPolicy";
import { selectTbmCrewInserts } from "@/lib/syncPermitCrewToTbm";

describe("permit ↔ TBM crew align policy", () => {
  it("refuses replacing permit crew with empty on-site list", () => {
    expect(shouldRefuseEmptyCrewReplace(0)).toBe(true);
    expect(shouldRefuseEmptyCrewReplace(-1)).toBe(true);
    expect(shouldRefuseEmptyCrewReplace(1)).toBe(false);
    expect(shouldRefuseEmptyCrewReplace(20)).toBe(false);
  });

  it("exposes clear Korean guards (no silent wipe)", () => {
    expect(EMPTY_ONSITE_CREW_GUARD).toMatch(/비우지 않았습니다/);
    expect(EMPTY_TBM_CREW_GUARD).toMatch(/비우지 않았습니다/);
  });
});

describe("selectTbmCrewInserts", () => {
  it("skips workers without a phone so unique(tbm_session_id, worker_phone) cannot collide on blanks", () => {
    const rows = selectTbmCrewInserts(
      [
        { id: "a", name: "갑", phone: "010-1111-1111", company_name: "A" },
        { id: "b", name: "을", phone: "", company_name: "A" },
        { id: "c", name: "병", phone: null, company_name: "A" },
      ],
      [],
    );
    expect(rows.map((w) => w.id)).toEqual(["a"]);
  });

  it("does not insert a second row for the same phone digits", () => {
    const rows = selectTbmCrewInserts(
      [
        { id: "a", name: "갑", phone: "010-1111-1111" },
        { id: "b", name: "을", phone: "01011111111" },
      ],
      [{ worker_id: "z", worker_phone: "010-2222-2222" }],
    );
    expect(rows.map((w) => w.id)).toEqual(["a"]);
  });

  it("skips workers already on the TBM roster", () => {
    const rows = selectTbmCrewInserts(
      [{ id: "a", name: "갑", phone: "01011111111" }],
      [{ worker_id: "a", worker_phone: "010-1111-1111" }],
    );
    expect(rows).toEqual([]);
  });
});
