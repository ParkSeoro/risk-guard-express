import { describe, expect, it } from "vitest";
import { deriveResidualLikelihood, isValidRiskGrade } from "@/lib/riskGrade";
import { shouldReplaceRiskField } from "@/lib/riskAutoGenAI";

describe("deriveResidualLikelihood", () => {
  it("drops one level from initial (never hard-all-하 for 상)", () => {
    expect(deriveResidualLikelihood("상")).toBe("중");
    expect(deriveResidualLikelihood("중")).toBe("하");
    expect(deriveResidualLikelihood("하")).toBe("하");
  });

  it("validates grades", () => {
    expect(isValidRiskGrade("상")).toBe(true);
    expect(isValidRiskGrade("중")).toBe(true);
    expect(isValidRiskGrade("하")).toBe(true);
    expect(isValidRiskGrade("")).toBe(false);
    expect(isValidRiskGrade(null)).toBe(false);
  });
});

describe("grade keep vs forceAll policy", () => {
  it("blank fields are replaceable when not forceAll", () => {
    expect(shouldReplaceRiskField("", false)).toBe(true);
    expect(shouldReplaceRiskField("상", false)).toBe(false);
  });

  it("forceAll always replaces narrative fields", () => {
    expect(shouldReplaceRiskField("기존 상황", true)).toBe(true);
  });
});

describe("workplan save/print source guards", () => {
  it("PDF buttons are not gated by saving lock", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/pages/WorkPlanDetail.tsx", "utf8");
    expect(src).toContain("pdfBusy");
    expect(src).toMatch(/disabled=\{pdfBusy\}/);
    expect(src).not.toMatch(/onClick=\{handlePdfDownload\} disabled=\{saving\}/);
    expect(src).toContain("riggingRef");
    expect(src).toContain("editEpochRef");
    expect(src).toContain("onDerivedPatch");
    expect(src).toContain("try {");
    expect(src).toContain("finally {\n      setSaving(false);");
  });

  it("applyFilledDetail keeps narrative grades and derives residual", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/riskAutoGenJob.ts", "utf8");
    expect(src).toContain("narrativeOnly");
    expect(src).toContain("deriveResidualLikelihood");
    expect(src).toContain("keepImprovedGrades");
  });

  it("edge risk AI derives residual when omitted", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("supabase/functions/generate-risk-ai/index.ts", "utf8");
    expect(src).toContain('likelihood === "상" ? "중" : "하"');
    expect(src).toContain('fill_stage: "narrative"');
  });

  it("workplan pdf edge keeps attachment print CSS", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("supabase/functions/generate-workplan-pdf/index.ts", "utf8");
    expect(src).toContain("attachment-print-img");
    expect(src).toContain("attachment-print-page");
    expect(src).toContain("max-height: 268mm");
  });
});
