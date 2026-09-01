import { openAttachmentUrl } from "@/lib/attachmentPreview";

export function WorkStopPhotos({
  urls,
  size = "md",
}: {
  urls: string[];
  size?: "sm" | "md";
}) {
  if (!urls.length) return null;
  const box = size === "sm" ? "h-14 w-14" : "aspect-square w-full";
  return (
    <div className={size === "sm" ? "flex gap-1" : "grid grid-cols-3 gap-1.5"}>
      {urls.map((url) => (
        <button
          key={url}
          type="button"
          className={`${box} overflow-hidden rounded border bg-muted shrink-0`}
          onClick={() => openAttachmentUrl(url)}
          aria-label="현장 사진 보기"
        >
          <img src={url} alt="현장 사진" className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  );
}
