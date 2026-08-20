import { describe, expect, it } from "vitest";
import {
  A4_LANDSCAPE_PX,
  A4_PORTRAIT_PX,
  MAX_USER_SCALE,
  MIN_USER_SCALE,
  appendFromQuery,
  clamp,
  clampDocumentPan,
  fitWidthScale,
  isApprovedPublishStatus,
  isMobileDocReadable,
  preparePrintHtmlForPreview,
} from "@/lib/approvalDocPreview";
import { mobileDocumentPath } from "@/lib/mobileNav";
import { extractWorkPlanHazardCards } from "@/lib/workPlanHazardCards";

describe("approval document mobile preview helpers", () => {
  it("treats in-approval statuses as readable on mobile (not only 승인완료)", () => {
    for (const status of ["결재진행", "결재중", "승인", "승인완료", "반려", "작성중"]) {
      expect(isMobileDocReadable(status)).toBe(true);
    }
    expect(isApprovedPublishStatus("결재진행")).toBe(false);
    expect(isApprovedPublishStatus("결재중")).toBe(false);
    expect(isApprovedPublishStatus("승인완료")).toBe(true);
    expect(isApprovedPublishStatus("승인")).toBe(true);
  });

  it("fits A4 page width to the phone viewport", () => {
    expect(fitWidthScale(390, A4_PORTRAIT_PX)).toBeCloseTo(390 / 794, 5);
    expect(fitWidthScale(390, A4_LANDSCAPE_PX)).toBeCloseTo(390 / 1123, 5);
    expect(fitWidthScale(0, A4_PORTRAIT_PX)).toBe(1);
  });

  it("clamps pan so a tall document can scroll but not float off-screen", () => {
    const scale = 390 / 794;
    const contentH = 3000;
    const vpW = 390;
    const vpH = 600;
    const atTop = clampDocumentPan(0, 0, scale, 794, contentH, vpW, vpH);
    expect(atTop.tx).toBeCloseTo((vpW - 794 * scale) / 2, 5);
    expect(atTop.ty).toBe(0);

    const tooHigh = clampDocumentPan(0, 50, scale, 794, contentH, vpW, vpH);
    expect(tooHigh.ty).toBe(0);

    const tooLow = clampDocumentPan(0, -99999, scale, 794, contentH, vpW, vpH);
    expect(tooLow.ty).toBeCloseTo(vpH - contentH * scale, 5);
  });

  it("injects a fixed page width into print HTML", () => {
    const src = `<!DOCTYPE html><html><head><title>t</title></head><body><button class="no-print">인쇄</button><p>본문</p></body></html>`;
    const out = preparePrintHtmlForPreview(src, A4_LANDSCAPE_PX);
    expect(out).toContain(`width: ${A4_LANDSCAPE_PX}px`);
    expect(out).toContain("safenex-preview-fit");
    expect(out).toContain("본문");
  });

  it("clamps user zoom range", () => {
    expect(clamp(0.1, MIN_USER_SCALE, MAX_USER_SCALE)).toBe(MIN_USER_SCALE);
    expect(clamp(99, MIN_USER_SCALE, MAX_USER_SCALE)).toBe(MAX_USER_SCALE);
  });

  it("appends from= so 문서 보기 returns to the inbox", () => {
    expect(appendFromQuery("/app/worker/risk-assessment/r1", "approvals")).toBe(
      "/app/worker/risk-assessment/r1?from=approvals",
    );
    expect(mobileDocumentPath("assessment_run", "r1", "approvals")).toBe(
      "/app/worker/risk-assessment/r1?from=approvals",
    );
    expect(mobileDocumentPath("work_plan", "w1", "approvals")).toBe(
      "/app/worker/work-plans/w1?from=approvals",
    );
  });

  it("extracts hazard cards from a pending work-plan body", () => {
    const cards = extractWorkPlanHazardCards([
      {
        key: "_ra_high_risks",
        content: "• [용접] 화재\n→ 소화기 비치",
      },
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0].hazard).toContain("화재");
    expect(cards[0].measure).toContain("소화기");
  });
});
