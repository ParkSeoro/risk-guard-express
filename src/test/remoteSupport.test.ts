import { describe, expect, it } from "vitest";
import {
  canRequestRemoteSupport,
  canTransitionStatus,
  isTerminalStatus,
  remoteSupportChannelName,
  remoteSupportDeepLink,
} from "@/lib/remoteSupport";
import { resolveNotificationRoute } from "@/lib/notificationRoutes";

describe("remoteSupport permissions", () => {
  it("allows only field users (not master, not agent)", () => {
    expect(canRequestRemoteSupport({ userId: "u1", isMaster: false, isAgent: false })).toBe(true);
    expect(canRequestRemoteSupport({ userId: "u1", isMaster: true, isAgent: false })).toBe(false);
    expect(canRequestRemoteSupport({ userId: "u1", isMaster: false, isAgent: true })).toBe(false);
    expect(canRequestRemoteSupport({ userId: "u1", isMaster: true, isAgent: true })).toBe(false);
    expect(canRequestRemoteSupport({ userId: null, isMaster: false, isAgent: false })).toBe(false);
  });
});

describe("remoteSupport session transitions", () => {
  it("marks ended/rejected/expired as terminal", () => {
    expect(isTerminalStatus("ended")).toBe(true);
    expect(isTerminalStatus("rejected")).toBe(true);
    expect(isTerminalStatus("expired")).toBe(true);
    expect(isTerminalStatus("pending")).toBe(false);
    expect(isTerminalStatus("active")).toBe(false);
  });

  it("allows pending → active/rejected/ended/expired", () => {
    expect(canTransitionStatus("pending", "active")).toBe(true);
    expect(canTransitionStatus("pending", "rejected")).toBe(true);
    expect(canTransitionStatus("pending", "ended")).toBe(true);
    expect(canTransitionStatus("pending", "expired")).toBe(true);
  });

  it("allows active → ended only", () => {
    expect(canTransitionStatus("active", "ended")).toBe(true);
    expect(canTransitionStatus("active", "rejected")).toBe(false);
    expect(canTransitionStatus("active", "pending")).toBe(false);
  });

  it("blocks transitions out of terminal states", () => {
    expect(canTransitionStatus("ended", "active")).toBe(false);
    expect(canTransitionStatus("rejected", "pending")).toBe(false);
    expect(canTransitionStatus("expired", "active")).toBe(false);
  });
});

describe("remoteSupport helpers", () => {
  it("builds channel and deep link", () => {
    expect(remoteSupportChannelName("abc")).toBe("remote-support:abc");
    expect(remoteSupportDeepLink("abc")).toBe("/app/admin/remote-support?session=abc");
  });
});

describe("remote_support notification routing", () => {
  it("opens the remote-support session page for agents", () => {
    expect(
      resolveNotificationRoute(
        {
          type: "remote_support",
          related_type: "remote_support_session",
          related_id: "sess-1",
        },
        { mobileShell: false },
      ),
    ).toBe("/app/admin/remote-support?session=sess-1");
  });

  it("uses explicit link when present", () => {
    expect(
      resolveNotificationRoute(
        {
          type: "remote_support",
          related_id: "sess-2",
          link: "/app/admin/remote-support?session=sess-2",
        },
        { mobileShell: false },
      ),
    ).toBe("/app/admin/remote-support?session=sess-2");
  });
});
