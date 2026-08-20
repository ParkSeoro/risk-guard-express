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
