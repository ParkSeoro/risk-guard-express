import { describe, it, expect } from "vitest";
import {
  EMPTY_ONSITE_CREW_GUARD,
  EMPTY_TBM_CREW_GUARD,
  shouldRefuseEmptyCrewReplace,
} from "@/lib/permitCrewPolicy";

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
