import { describe, expect, it } from "vitest";
import {
  visionEventSirenAllowed,
  visionFleetFnPath,
  visionGrantTtlMs,
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
