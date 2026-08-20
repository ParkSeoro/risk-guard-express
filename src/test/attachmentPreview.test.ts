import { describe, expect, it } from "vitest";
import { classifyAttachmentFile } from "@/lib/attachmentPreview";

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
