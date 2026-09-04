import { describe, expect, it } from "vitest";
import { pickAckTbmSessionIds } from "@/lib/dailyWorkAck";

describe("pickAckTbmSessionIds", () => {
  it("uses assigned permit TBMs when present", () => {
    expect(
      pickAckTbmSessionIds({
        assignedPermitTbmIds: ["tbm-a", "", "tbm-a"],
        companyTodayTbmIds: ["tbm-b"],
      }),
    ).toEqual(["tbm-a"]);
  });

  it("falls back to the company TBM when the worker is not on a permit", () => {
    expect(
      pickAckTbmSessionIds({
        assignedPermitTbmIds: [],
        companyTodayTbmIds: ["tbm-b", "tbm-b"],
      }),
    ).toEqual(["tbm-b"]);
  });
});
