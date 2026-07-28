import { describe, it, expect } from "vitest";
import { alarmRoleHonorific, formatAlarmSubject, buildDangerTtsMessage } from "@/lib/alarmRoleLabel";

describe("alarmRoleHonorific", () => {
  it("maps admin/manager/master to 관리자님", () => {
    expect(alarmRoleHonorific("master")).toBe("관리자님");
    expect(alarmRoleHonorific("admin")).toBe("관리자님");
    expect(alarmRoleHonorific("project_admin")).toBe("관리자님");
  });

  it("maps worker to 근로자", () => {
    expect(alarmRoleHonorific("worker")).toBe("근로자");
  });

  it("formats subject without hardcoding 근로자", () => {
    expect(formatAlarmSubject("박서로", "master")).toBe("박서로 관리자님");
    expect(formatAlarmSubject("박서로", "worker")).toBe("박서로 근로자");
  });

  it("personalizes TTS", () => {
    const msg = buildDangerTtsMessage({ displayName: "박서로", role: "master" });
    expect(msg).toContain("박서로 관리자님");
    expect(msg).toContain("위험 구역");
    expect(msg).not.toMatch(/박서로 근로자/);
  });
});
