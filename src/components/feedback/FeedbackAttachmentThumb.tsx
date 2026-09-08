import { useState } from "react";
import { FileText, X } from "lucide-react";
import { classifyAttachmentFile, openAttachmentUrl } from "@/lib/attachmentPreview";

type Props = {
  url: string;
  label?: string;
  className?: string;
  mime?: string | null;
  name?: string | null;
  onRemove?: () => void;
  removeLabel?: string;
};

/** 피드백 조치 전후 첨부 — PDF는 img가 깨지므로 문서 칩으로 연다. */
export default function FeedbackAttachmentThumb({
  url,
  label = "첨부",
  className = "w-12 h-12",
  mime,
  name,
  onRemove,
  removeLabel = "첨부 삭제",
}: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const kind = classifyAttachmentFile({ url, mime, name });
  const showImage = kind === "image" && !imgFailed;

  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    openAttachmentUrl(url);
  };

  const body = !showImage ? (
    <button
      type="button"
      onClick={open}
      title={label}
      className={`${className} rounded border bg-muted flex flex-col items-center justify-center gap-0.5 text-[8px] font-medium text-muted-foreground shrink-0`}
    >
      <FileText className="h-4 w-4" />
      {kind === "pdf" || /\.pdf($|\?)/i.test(url) ? "PDF" : "파일"}
    </button>
  ) : (
    <img
      src={url}
      alt={label}
      className={`${className} rounded object-cover border cursor-pointer shrink-0`}
      onClick={open}
      onError={() => setImgFailed(true)}
    />
  );

  return (
    <div className="relative inline-block shrink-0">
      {body}
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          title={removeLabel}
          className="absolute -top-1.5 -right-1.5 z-10 h-5 w-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onRemove();
          }}
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}
