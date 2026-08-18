import { afterEach, describe, expect, it } from "vitest";
import {
  isPlatformMaster,
  MASTER_OFFSITE_ALARM_TEST_KEY,
  readMasterOffsiteAlarmTest,
  writeMasterOffsiteAlarmTest,
} from "@/lib/tracking/masterOffsiteAlarmTest";

describe("master off-site alarm test flag", () => {
  afterEach(() => {
    localStorage.removeItem(MASTER_OFFSITE_ALARM_TEST_KEY);
  });

  it("is off by default", () => {
    expect(readMasterOffsiteAlarmTest()).toBe(false);
  });

  it("round-trips through localStorage", () => {
    writeMasterOffsiteAlarmTest(true);
    expect(readMasterOffsiteAlarmTest()).toBe(true);
    writeMasterOffsiteAlarmTest(false);
    expect(readMasterOffsiteAlarmTest()).toBe(false);
  });

  it("detects platform master from hasRole or the roles list", () => {
    expect(isPlatformMaster(() => true, [])).toBe(true);
    expect(isPlatformMaster(() => false, ["project_admin", "master"])).toBe(true);
    expect(isPlatformMaster(() => false, ["safety_manager"])).toBe(false);
  });
});
