import { isSafeSignatureDataUrl } from "@/lib/assessmentShareAck";

export default function SignaturePreview({
  data,
  label,
  text,
}: {
  data?: string | null;
  label?: string;
  text?: string | null;
}) {
  return (
    <div className="rounded-lg border p-3 space-y-2 bg-muted/20">
      {label && <div className="text-xs font-semibold text-muted-foreground">{label}</div>}
      {text && <p className="text-xs leading-relaxed whitespace-pre-wrap">{text}</p>}
      {isSafeSignatureDataUrl(data) ? (
        <img src={data || ""} alt={label || "서명"} className="max-h-28 bg-white rounded border" />
      ) : (
        <p className="text-xs text-muted-foreground">서명 이미지가 없습니다.</p>
      )}
    </div>
  );
}
