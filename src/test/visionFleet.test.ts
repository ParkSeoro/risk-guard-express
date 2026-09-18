import { describe, expect, it } from "vitest";
import {
  VISION_LIVE_ACTION,
  visionCameraSlots,
  visionCanOperate,
  visionCanViewConsole,
  visionEventSirenAllowed,
  visionFleetFnPath,
  visionGrantBitrateKbps,
  visionGrantTtlMs,
  visionQuadPageCount,
  visionRoleLabel,
  visionSafePlaybackUrl,
} from "@/lib/visionFleetApi";
import { resolveNotificationRoute, toMobileShellPath } from "@/lib/notificationRoutes";

describe("vision fleet client helpers", () => {
  it("keeps /v1 prefix under the vision-fleet function", () => {
    expect(visionFleetFnPath("/v1/stream-grants")).toBe("vision-fleet/v1/stream-grants");
    expect(visionFleetFnPath("stream-grants")).toBe("vision-fleet/v1/stream-grants");
    expect(visionFleetFnPath("/v1/gateway-device-authorizations/lookup")).toBe(
      "vision-fleet/v1/gateway-device-authorizations/lookup",
    );
  });

  it("issues a 5 minute live_substream grant", () => {
    expect(visionGrantTtlMs("live_substream")).toBe(5 * 60_000);
  });

  it("defaults live wall grants to high-quality mainstream", () => {
    expect(VISION_LIVE_ACTION).toBe("live_mainstream");
    expect(visionGrantTtlMs("live_mainstream")).toBe(30 * 60_000);
    expect(visionGrantBitrateKbps("live_mainstream")).toBe(4096);
    expect(visionGrantBitrateKbps("live_substream")).toBe(700);
  });

  it("shows a 4-slot camera board even when nothing is connected", () => {
    expect(visionCameraSlots([]).every((s) => s === null)).toBe(true);
    expect(visionCameraSlots([]).length).toBe(4);
    expect(visionCameraSlots([{ id: "c1" }])[0]).toEqual({ id: "c1" });
    expect(visionCameraSlots([{ id: "c1" }]).filter((s) => s === null)).toHaveLength(3);
  });

  it("pages cameras 4 at a time when there are dozens", () => {
    const cams = Array.from({ length: 9 }, (_, i) => ({ id: `c${i + 1}` }));
    expect(visionQuadPageCount(9)).toBe(3);
    expect(visionCameraSlots(cams, 1).map((c) => c?.id)).toEqual(["c5", "c6", "c7", "c8"]);
    expect(visionCameraSlots(cams, 2).filter(Boolean)).toHaveLength(1);
  });

  it("rejects RTSP and credentialed URLs for web playback", () => {
    expect(visionSafePlaybackUrl("rtsp://cam/stream1")).toBeNull();
    expect(visionSafePlaybackUrl("https://user:pass@example.com/live.m3u8")).toBeNull();
    expect(visionSafePlaybackUrl("https://cdn.example.com/live.m3u8")).toBe("https://cdn.example.com/live.m3u8");
  });

  it("lets supervisors open the console but not provision", () => {
    expect(visionCanViewConsole(["supervisor"])).toBe(true);
    expect(visionCanOperate(["supervisor"])).toBe(false);
    expect(visionCanOperate(["safety_manager"])).toBe(true);
    expect(visionRoleLabel(["site_manager"])).toBe("현장소장");
  });

  it("never allows a siren for vision_safety_event", () => {
    expect(
      visionEventSirenAllowed({
        type: "vision_safety_event",
        severity: "critical",
        alarmInterlockEnabled: true,
      }),
    ).toBe(false);
  });
});

describe("vision notification routing", () => {
  it("opens admin fleet and mobile event queue", () => {
    expect(
      resolveNotificationRoute(
        { type: "vision_safety_event", related_id: "e1" },
        { mobileShell: false },
      ),
    ).toBe("/app/admin/vision-fleet?event=e1");
    expect(
      resolveNotificationRoute(
        { type: "vision_safety_event", related_id: "e1" },
        { mobileShell: true },
      ),
    ).toBe("/app/worker/vision-events?event=e1");
    expect(toMobileShellPath("/app/admin/vision-fleet?event=e1")).toBe(
      "/app/worker/vision-events?event=e1",
    );
  });
});
