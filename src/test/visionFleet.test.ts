import { describe, expect, it } from "vitest";
import {
  visionCameraSlots,
  visionCanOperate,
  visionCanViewConsole,
  visionEventSirenAllowed,
  visionFleetFnPath,
  visionGrantTtlMs,
  visionRoleLabel,
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

  it("shows a 4-slot camera board even when nothing is connected", () => {
    expect(visionCameraSlots([]).every((s) => s === null)).toBe(true);
    expect(visionCameraSlots([]).length).toBe(4);
    expect(visionCameraSlots([{ id: "c1" }])[0]).toEqual({ id: "c1" });
    expect(visionCameraSlots([{ id: "c1" }]).filter((s) => s === null)).toHaveLength(3);
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
