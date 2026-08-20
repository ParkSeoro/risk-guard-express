/** Classify a work-plan attachment so reviewers can open it inline. */
export function classifyAttachmentFile(opts: {
  url?: string | null;
  mime?: string | null;
  name?: string | null;
}): "image" | "pdf" | "other" {
  const mime = String(opts.mime || "").toLowerCase().split(";")[0].trim();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";

  const hay = `${opts.url || ""} ${opts.name || ""}`.toLowerCase().split("?")[0];
  if (/\.(jpg|jpeg|png|gif|webp|bmp|svg)$/i.test(hay)) return "image";
  if (/\.pdf$/i.test(hay)) return "pdf";
  return "other";
}

export function hasUploadedFile(url?: string | null): boolean {
  return typeof url === "string" && url.trim().length > 0;
}

/** Chrome PDF viewer: fit width. Preserve existing query/hash. */
export function pdfEmbedSrc(url: string): string {
  const raw = String(url || "").trim();
  if (!raw) return raw;
  if (/[?#].*view=/i.test(raw)) return raw;
  return raw.includes("#") ? `${raw}&view=FitH` : `${raw}#view=FitH`;
}

export function attachmentReviewEmptyState(opts: {
  error?: string | null;
  uploadedCount: number;
  slotCount: number;
}): { kind: "error" | "empty"; message: string } | null {
  if (opts.error) {
    return { kind: "error", message: opts.error };
  }
  if (opts.uploadedCount > 0) return null;
  if (opts.slotCount > 0) {
    return {
      kind: "empty",
      message: `첨부 칸은 ${opts.slotCount}개 있으나 아직 올린 파일이 없습니다.`,
    };
  }
  return { kind: "empty", message: "첨부된 파일이 없습니다." };
}
