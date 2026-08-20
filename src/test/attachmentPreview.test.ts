import { describe, expect, it } from "vitest";
import {
  attachmentReviewEmptyState,
  classifyAttachmentFile,
  hasUploadedFile,
  pdfEmbedSrc,
} from "@/lib/attachmentPreview";

describe("classifyAttachmentFile", () => {
  it("uses mime first", () => {
    expect(classifyAttachmentFile({ mime: "application/pdf" })).toBe("pdf");
    expect(classifyAttachmentFile({ mime: "image/jpeg" })).toBe("image");
    expect(classifyAttachmentFile({ mime: "application/vnd.ms-excel" })).toBe("other");
  });

  it("falls back to url/name extension", () => {
    expect(classifyAttachmentFile({ url: "https://x/a.PDF?token=1" })).toBe("pdf");
    expect(classifyAttachmentFile({ name: "현장사진.png" })).toBe("image");
    expect(classifyAttachmentFile({ url: "https://x/notes.docx" })).toBe("other");
  });
});

describe("hasUploadedFile", () => {
  it("treats blank urls as missing", () => {
    expect(hasUploadedFile(null)).toBe(false);
    expect(hasUploadedFile("  ")).toBe(false);
    expect(hasUploadedFile("https://x/a.pdf")).toBe(true);
  });
});

describe("pdfEmbedSrc", () => {
  it("adds FitH for chrome viewer", () => {
    expect(pdfEmbedSrc("https://x/a.pdf")).toBe("https://x/a.pdf#view=FitH");
  });
});

describe("attachmentReviewEmptyState", () => {
  it("surfaces query errors instead of pretending there are no files", () => {
    expect(attachmentReviewEmptyState({ error: "permission denied", uploadedCount: 0, slotCount: 22 })?.kind).toBe("error");
  });

  it("distinguishes empty slots from a missing table", () => {
    expect(attachmentReviewEmptyState({ uploadedCount: 0, slotCount: 22 })?.message).toMatch(/22개/);
    expect(attachmentReviewEmptyState({ uploadedCount: 18, slotCount: 22 })).toBeNull();
  });
});
