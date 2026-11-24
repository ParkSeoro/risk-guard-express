import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CUSTOM_ATTACHMENT_KEY_PREFIX,
  isCustomAttachmentKey,
} from "@/lib/workPlanAttachments";
import { computeWorkPlanNextActions } from "@/lib/workPlanNextActions";

describe("WorkPlan Phase 0 — safety guards & custom attachments", () => {
  it("recognizes user-added custom attachment keys without touching template keys", () => {
    expect(isCustomAttachmentKey(`${CUSTOM_ATTACHMENT_KEY_PREFIX}1795486000000`)).toBe(true);
    expect(isCustomAttachmentKey("biz_license")).toBe(false);
    expect(isCustomAttachmentKey(null)).toBe(false);
    expect(isCustomAttachmentKey(undefined)).toBe(false);
  });

  it("enforces readOnly guard before syncTemplateRows and preserves custom_* keys", () => {
    const checklistSrc = readFileSync(
      "src/components/work-plan/AttachmentChecklist.tsx",
      "utf8",
    );
    expect(checklistSrc).toMatch(/if\s*\(!readOnly\)\s*\{[\s\S]*?syncTemplateRows/);
    expect(checklistSrc).toContain("work_conditions");
    expect(checklistSrc).toContain("기타 증빙 추가");

    const attLibSrc = readFileSync("src/lib/workPlanAttachments.ts", "utf8");
    expect(attLibSrc).toContain("isCustomAttachmentKey(row.attachment_key)");
  });

  it("removes duplicate AttachmentReviewPanel from attachments tab while keeping it in preview tab", () => {
    const detailSrc = readFileSync("src/pages/WorkPlanDetail.tsx", "utf8");
    const attTabStart = detailSrc.indexOf('<TabsContent value="attachments"');
    const previewTabStart = detailSrc.indexOf('<TabsContent value="preview"');
    expect(attTabStart).toBeGreaterThan(-1);
    expect(previewTabStart).toBeGreaterThan(attTabStart);

    const attTabSlice = detailSrc.slice(attTabStart, previewTabStart);
    const previewTabSlice = detailSrc.slice(previewTabStart);
    expect(attTabSlice).not.toContain("<AttachmentReviewPanel");
    expect(attTabSlice).toContain("<AttachmentChecklist");
    expect(previewTabSlice).toContain("<AttachmentReviewPanel");
  });

  it("computes remaining prerequisite jump actions cleanly", () => {
    const incomplete = computeWorkPlanNextActions({
      workType: "other_hazardous",
      startDate: "",
      endDate: "",
      authorUserId: null,
      mandatoryMissing: 3,
    });
    expect(incomplete.map((a) => a.tab)).toEqual(["basic", "author", "attachments"]);
    expect(incomplete[2].label).toContain("3건");

    const ready = computeWorkPlanNextActions({
      workType: "other_hazardous",
      startDate: "2026-11-24",
      endDate: "2026-11-25",
      authorUserId: "user-123",
      mandatoryMissing: 0,
    });
    expect(ready).toEqual([]);
  });
});
