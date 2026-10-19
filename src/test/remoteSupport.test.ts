import { describe, expect, it } from "vitest";
import {
  canRequestRemoteSupport,
  canSubmitRemoteSupportRequest,
  canTransitionStatus,
  isTerminalStatus,
  remoteSupportChannelName,
  remoteSupportDeepLink,
} from "@/lib/remoteSupport";
import {
  clientPointToNormalized,
  isSafeNexAppPath,
  normalizedToViewport,
  videoObjectContainBox,
} from "@/lib/remoteSupportControl";
import { resolveNotificationRoute } from "@/lib/notificationRoutes";

describe("remoteSupport permissions", () => {
  it("allows only field users (not master, not agent)", () => {
    expect(canRequestRemoteSupport({ userId: "u1", isMaster: false, isAgent: false })).toBe(true);
    expect(canRequestRemoteSupport({ userId: "u1", isMaster: true, isAgent: false })).toBe(false);
    expect(canRequestRemoteSupport({ userId: "u1", isMaster: false, isAgent: true })).toBe(false);
    expect(canRequestRemoteSupport({ userId: "u1", isMaster: true, isAgent: true })).toBe(false);
    expect(canRequestRemoteSupport({ userId: null, isMaster: false, isAgent: false })).toBe(false);
  });

  it("requires prior contact confirmation before submit", () => {
    expect(canSubmitRemoteSupportRequest({ contactedConfirmed: false, agentId: "a1" })).toBe(false);
    expect(canSubmitRemoteSupportRequest({ contactedConfirmed: true, agentId: "" })).toBe(false);
    expect(canSubmitRemoteSupportRequest({ contactedConfirmed: true, agentId: "a1" })).toBe(true);
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

describe("remoteSupport control mapping", () => {
  it("allows only SafeNex in-app paths", () => {
    expect(isSafeNexAppPath("/app/admin/work-permits")).toBe(true);
    expect(isSafeNexAppPath("/app/worker/today")).toBe(true);
    expect(isSafeNexAppPath("/settings/account")).toBe(true);
    expect(isSafeNexAppPath("https://evil.example")).toBe(false);
    expect(isSafeNexAppPath("//evil.example")).toBe(false);
    expect(isSafeNexAppPath("/landing")).toBe(false);
  });

  it("maps letterboxed video clicks to normalized coords", () => {
    const video = {
      clientWidth: 800,
      clientHeight: 450,
      videoWidth: 1600,
      videoHeight: 900,
      getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 450 }),
    } as unknown as HTMLVideoElement;

    const box = videoObjectContainBox(video);
    expect(box).toEqual({ offsetX: 0, offsetY: 0, contentW: 800, contentH: 450 });

    const center = clientPointToNormalized(video, 100 + 400, 50 + 225);
    expect(center).toEqual({ x: 0.5, y: 0.5 });

    const outside = clientPointToNormalized(video, 10, 10);
    expect(outside).toBeNull();
  });

  it("converts normalized coords to viewport pixels", () => {
    const prevW = window.innerWidth;
    const prevH = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1000 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 500 });
    expect(normalizedToViewport({ x: 0.5, y: 0.25 })).toEqual({ x: 500, y: 125 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: prevW });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: prevH });
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
