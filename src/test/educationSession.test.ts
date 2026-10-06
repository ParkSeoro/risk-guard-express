import { describe, expect, it } from "vitest";
import { EDUCATION_OUTLINES, EDUCATION_SESSION_TYPES } from "@/lib/educationOutlines";
import { daysUntilHalfEnd, halfYearBounds } from "@/lib/educationPeriod";
import { educationLogHtml } from "@/lib/educationPrint";
import { resolveNotificationRoute } from "@/lib/notificationRoutes";

describe("education sessions", () => {
  it("uses the Seoul half-year that the SQL window uses", () => {
    expect(halfYearBounds("2026-03-01")).toEqual({ start: "2026-01-01", end: "2026-06-30" });
    expect(halfYearBounds("2026-10-06")).toEqual({ start: "2026-07-01", end: "2026-12-31" });
    expect(daysUntilHalfEnd("2026-12-01")).toBe(30);
  });

  it("ships a site outline for every session type and not for certificates", () => {
    for (const key of EDUCATION_SESSION_TYPES) {
      expect(EDUCATION_OUTLINES[key].outline.length).toBeGreaterThan(20);
      expect(EDUCATION_OUTLINES[key].title.length).toBeGreaterThan(0);
    }
    expect(EDUCATION_SESSION_TYPES).not.toContain("new_hire_construction");
  });

  it("prints the class once with each signature", () => {
    const html = educationLogHtml({
      courseName: "정기",
      educationLabel: "정기 안전보건교육",
      heldOn: "2026-10-06",
      hours: 1,
      instructor: "김강사",
      place: "식당",
      outline: "위험요인",
      photoUrls: [],
      attendees: [{ name: "이근로", company: "협력", signature: "data:image/png;base64,abc" }],
    });
    expect(html).toContain("이근로");
    expect(html).toContain("data:image/png;base64,abc");
    expect(html).not.toContain("<script");
  });

  it("opens the education list from a bundled alarm", () => {
    expect(
      resolveNotificationRoute(
        { type: "education_gap", link: "/app/admin/worker-education" },
        { mobileShell: false },
      ),
    ).toBe("/app/admin/worker-education");
    expect(
      resolveNotificationRoute(
        { type: "education_gap", link: "/app/admin/worker-education?focus=certificate" },
        { mobileShell: true },
      ),
    ).toBe("/app/worker/education-sign");
    expect(
      resolveNotificationRoute({ type: "education_gap" }, { mobileShell: false }),
    ).toBe("/app/admin/worker-education");
  });
});
