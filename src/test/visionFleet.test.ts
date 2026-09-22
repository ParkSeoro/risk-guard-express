import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  VISION_LIVE_ACTION,
  VISION_LIVE_IDLE_MS,
  sortVisionCamerasByRegistered,
  visionCanManage,
  visionCanOperate,
  visionCanViewConsole,
  visionEventSirenAllowed,
  visionFleetFnPath,
  visionGrantBitrateKbps,
  visionGrantTtlMs,
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

  it("defaults live playback to the first registered camera", () => {
    const cams = [
      { id: "c2", created_at: "2026-09-22T02:00:00Z" },
      { id: "c1", created_at: "2026-09-21T02:00:00Z" },
      { id: "c3", created_at: null },
    ];
    expect(sortVisionCamerasByRegistered(cams).map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
    expect(VISION_LIVE_IDLE_MS).toBe(10 * 60_000);
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

  it("restricts camera setup to master only", () => {
    expect(visionCanManage(["master"])).toBe(true);
    expect(visionCanManage(["safety_manager"])).toBe(false);
    expect(visionCanManage(["project_admin"])).toBe(false);
    expect(visionCanManage(["site_manager"])).toBe(false);
  });

  it("keeps setup, edit, and delete off the wall for everyone except master", () => {
    const src = readFileSync("src/pages/VisionFleet.tsx", "utf8");
    expect(src).toContain("visionCanManage");
    expect(src).toContain("VisionCameraManageList");
    expect(src).toContain("VisionVpsSetup");
    expect(src).toContain("MobileVisionPlayer");
    expect(src).toContain("created_at");
    expect(src).toContain("applyCompanyFilter");
    expect(src).toContain("includeOrphans");
    expect(src).toContain("company_id");
    expect(src).not.toContain("VisionQuadGrid");
    expect(src).not.toContain("VisionMuxSetup");
    expect(src).not.toContain("VisionRelaySetup");
    expect(src).not.toContain("시작.bat");
    expect(src).not.toContain("설치 키트");
    expect(src).not.toContain("현장 Gateway");
    expect(src).not.toContain("안전 이벤트");
  });

  it("drops unused Mux and local-relay helpers", () => {
    const api = readFileSync("src/lib/visionFleetApi.ts", "utf8");
    expect(api).not.toContain("VISION_RELAY_SLOTS");
    expect(api).not.toContain("visionRelayBase");
    expect(api).not.toContain("VISION_CAMERA_SLOTS");
    expect(api).not.toContain("visionCameraSlots");
    const edge = readFileSync("supabase/functions/vision-fleet/index.ts", "utf8");
    expect(edge).not.toContain("mux.com");
    expect(edge).not.toContain("wantMux");
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
