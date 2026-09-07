import { useState } from "react";
import { FileText } from "lucide-react";
import { classifyAttachmentFile, openAttachmentUrl } from "@/lib/attachmentPreview";

type Props = {
  url: string;
  label?: string;
  className?: string;
  mime?: string | null;
  name?: string | null;
};

/** 피드백 조치 전후 첨부 — PDF는 img가 깨지므로 문서 칩으로 연다. */
export default function FeedbackAttachmentThumb({
  url,
  label = "첨부",
  className = "w-12 h-12",
  mime,
  name,
}: Props) {
  const [imgFailed, setImgFailed] = useState(false);
  const kind = classifyAttachmentFile({ url, mime, name });
  const showImage = kind === "image" && !imgFailed;

  const open = (e: React.MouseEvent) => {
    e.stopPropagation();
    openAttachmentUrl(url);
  };

  if (!showImage) {
    return (
      <button
        type="button"
        onClick={open}
        title={label}
        className={`${className} rounded border bg-muted flex flex-col items-center justify-center gap-0.5 text-[8px] font-medium text-muted-foreground shrink-0`}
      >
        <FileText className="h-4 w-4" />
        {kind === "pdf" || /\.pdf($|\?)/i.test(url) ? "PDF" : "파일"}
      </button>
    );
  }

  return (
    <img
      src={url}
      alt={label}
      className={`${className} rounded object-cover border cursor-pointer shrink-0`}
      onClick={open}
      onError={() => setImgFailed(true)}
    />
  );
}
