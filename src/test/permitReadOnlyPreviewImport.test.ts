import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const PREVIEW_IMPORT = /import PermitReadOnlyPreview from ["']@\/components\/permits\/PermitReadOnlyPreview["']/;

describe("PermitReadOnlyPreview is imported where JSX uses it", () => {
  it.each([
    "src/components/approval/ApprovalDocPreviewDialog.tsx",
    "src/pages/MobileApprovalDetail.tsx",
  ])("%s imports PermitReadOnlyPreview", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toMatch(/<PermitReadOnlyPreview[\s>]/);
    expect(src).toMatch(PREVIEW_IMPORT);
  });
});
