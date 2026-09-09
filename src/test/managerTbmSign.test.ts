import { describe, expect, it } from "vitest";
import { isClientType } from "@/lib/companyTypes";
import {
  managerTbmSignPath,
  mapPendingManagerTbmSign,
  needsManagerTbmSign,
} from "@/lib/managerTbmSign";
import { formatTbmParticipationTime } from "@/lib/tbmParticipationTime";
import { resolveNotificationRoute } from "@/lib/notificationRoutes";

const SIG = `data:image/png;base64,${"A".repeat(80)}`;

describe("needsManagerTbmSign", () => {
  it("excludes 발주처 and includes 시공사 이하", () => {
    expect(needsManagerTbmSign("client")).toBe(false);
    expect(isClientType("발주처")).toBe(true);
    expect(needsManagerTbmSign("발주처")).toBe(false);
    expect(needsManagerTbmSign("gc")).toBe(true);
    expect(needsManagerTbmSign("contractor")).toBe(true);
    expect(needsManagerTbmSign("vendor")).toBe(true);
    expect(needsManagerTbmSign("시공사")).toBe(true);
  });
});

describe("managerTbmSignPath", () => {
  it("deep-links a session", () => {
    expect(managerTbmSignPath("abc")).toBe("/app/worker/tbm-sign?session=abc");
    expect(managerTbmSignPath()).toBe("/app/worker/tbm-sign");
  });
});

describe("mapPendingManagerTbmSign", () => {
  it("reads session_id", () => {
    expect(mapPendingManagerTbmSign({ session_id: "s1", project_id: "p1" })?.session_id).toBe("s1");
    expect(mapPendingManagerTbmSign({})).toBeNull();
  });
});

describe("formatTbmParticipationTime", () => {
  it("shows 미서명 until a real signature exists", () => {
    expect(formatTbmParticipationTime({
      participated_at: "2026-09-08T10:33:45+09:00",
      signature_data: null,
    })).toBe("미서명");
    expect(formatTbmParticipationTime({
      participated_at: "2026-09-08T10:33:45+09:00",
      signature_data: SIG,
    })).toMatch(/2026/);
  });
});

describe("tbm_sign_due routing", () => {
  it("opens manager sign page from morning alarm", () => {
    expect(
      resolveNotificationRoute(
        { type: "tbm_sign_due", related_id: "sess-1", related_type: "tbm_session" },
        { mobileShell: true },
      ),
    ).toBe("/app/worker/tbm-sign?session=sess-1");
    expect(
      resolveNotificationRoute(
        { type: "tbm_sign_due", link: "/app/worker/tbm-sign?session=sess-1" },
        { mobileShell: false },
      ),
    ).toBe("/app/worker/tbm-sign?session=sess-1");
  });
});
