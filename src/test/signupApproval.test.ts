import { describe, expect, it } from "vitest";
import {
  canApprovePendingSignup,
  isClientOwnerSmAnywhere,
  isClientOwnerSmMembership,
} from "@/lib/signupApproval";
import { resolveNotificationRoute } from "@/lib/notificationRoutes";

describe("signupApproval", () => {
  it("recognizes client OWNER_SM / OWNER_HSE only", () => {
    expect(
      isClientOwnerSmMembership({
        project_id: "p1",
        position_new: "OWNER_SM",
        company_type: "client",
      }),
    ).toBe(true);
    expect(
      isClientOwnerSmMembership({
        project_id: "p1",
        position_new: "OWNER_HSE",
        company_type: "client",
      }),
    ).toBe(true);
    expect(
      isClientOwnerSmMembership({
        project_id: "p1",
        position_new: "OWNER_SM",
        company_type: "gc",
      }),
    ).toBe(false);
    expect(
      isClientOwnerSmMembership({
        project_id: "p1",
        position_new: "OWNER_CM",
        company_type: "client",
      }),
    ).toBe(false);
    expect(
      isClientOwnerSmMembership({
        project_id: "p1",
        position_new: "EXECUTIVE",
        company_type: "contractor",
      }),
    ).toBe(false);
  });

  it("lets master approve; owner SM only on shared project", () => {
    const sm = [
      { project_id: "p1", position_new: "OWNER_SM", company_type: "client" },
    ];
    expect(canApprovePendingSignup({ isMaster: true, approverMemberships: [], targetProjectIds: ["p1"] })).toBe(
      true,
    );
    expect(
      canApprovePendingSignup({
        isMaster: false,
        approverMemberships: sm,
        targetProjectIds: ["p1"],
      }),
    ).toBe(true);
    expect(
      canApprovePendingSignup({
        isMaster: false,
        approverMemberships: sm,
        targetProjectIds: ["p2"],
      }),
    ).toBe(false);
    expect(
      canApprovePendingSignup({
        isMaster: false,
        approverMemberships: [
          { project_id: "p1", position_new: "OWNER_CM", company_type: "client" },
        ],
        targetProjectIds: ["p1"],
      }),
    ).toBe(false);
  });

  it("detects owner SM anywhere for page access", () => {
    expect(
      isClientOwnerSmAnywhere([
        { project_id: "p1", position_new: "OWNER_CM", company_type: "client" },
        { project_id: "p2", position_new: "OWNER_SM", company_type: "client" },
      ]),
    ).toBe(true);
    expect(
      isClientOwnerSmAnywhere([
        { project_id: "p1", position_new: "OWNER_SM", company_type: "gc" },
      ]),
    ).toBe(false);
  });
});

describe("signup_pending notification routing", () => {
  it("opens permissions pending tab", () => {
    expect(
      resolveNotificationRoute(
        { type: "signup_pending", related_type: "profile", related_id: "u1" },
        { mobileShell: false },
      ),
    ).toBe("/app/admin/settings/permissions?tab=pending");
  });
});
