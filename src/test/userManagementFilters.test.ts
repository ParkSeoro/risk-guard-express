import { describe, expect, it } from "vitest";
import {
  matchesManageableUserFilters,
  skipPersonaForApprovalQueue,
} from "@/lib/userManagementFilters";
import { classifyPermissionPersona } from "@/lib/permissions";

const pendingWorker = {
  user_id: "u-pending",
  account_status: "pending",
  display_name: "김선린",
  company: "진남토건(주)",
  phone: "",
  email: "",
  roles: [] as string[],
};
const workerMem = [{ user_id: "u-pending", project_id: "proj-1", role_new: "worker" }];

describe("승인대기 목록 필터", () => {
  it("가입 승인대기는 현장 작업자 소속이어도 worker 페르소나다", () => {
    expect(classifyPermissionPersona({ globalRoles: [], projectRoles: ["worker"] })).toBe("worker");
  });

  it("관리자 탭 + 승인대기 탭이면 예전에는 0명이 되었고, 지금은 보여야 한다", () => {
    expect(skipPersonaForApprovalQueue("pending")).toBe(true);
    expect(
      matchesManageableUserFilters({
        user: pendingWorker,
        memberships: workerMem,
        filterStatus: "pending",
        filterProject: "all",
        filterPersona: "manager",
        search: "",
      }),
    ).toBe(true);
  });

  it("활성 탭의 관리자 필터는 근로자 승인대기를 숨긴다", () => {
    expect(
      matchesManageableUserFilters({
        user: { ...pendingWorker, account_status: "active" },
        memberships: workerMem,
        filterStatus: "active",
        filterProject: "all",
        filterPersona: "manager",
        search: "",
      }),
    ).toBe(false);
  });

  it("검색어가 있으면 승인대기여도 이름에 맞아야 한다", () => {
    expect(
      matchesManageableUserFilters({
        user: pendingWorker,
        memberships: workerMem,
        filterStatus: "pending",
        filterProject: "all",
        filterPersona: "manager",
        search: "없는이름",
      }),
    ).toBe(false);
    expect(
      matchesManageableUserFilters({
        user: pendingWorker,
        memberships: workerMem,
        filterStatus: "pending",
        filterProject: "all",
        filterPersona: "manager",
        search: "김선린",
      }),
    ).toBe(true);
  });
});
