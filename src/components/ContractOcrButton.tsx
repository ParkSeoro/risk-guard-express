import { useState } from "react";
import { Loader2, ScanText } from "lucide-react";
import { toast } from "sonner";
import { extractDocumentDraft, type ConstructionContractDraft } from "@/lib/ocrDocumentDraft";

interface Props {
  disabled?: boolean;
  onDraft: (draft: ConstructionContractDraft) => void;
}

export function ContractOcrButton({ disabled, onDraft }: Props) {
  const [loading, setLoading] = useState(false);

  return (
    <label
      className={`inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium ${
        disabled || loading ? "opacity-50 pointer-events-none" : "hover:bg-accent cursor-pointer"
      }`}
    >
      {loading ? <Loader2 className="size-3.5 animate-spin" /> : <ScanText className="size-3.5" />}
      <span>{loading ? "판독 중..." : "계약서·발주서 OCR 자동입력"}</span>
      <input
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        disabled={disabled || loading}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setLoading(true);
          try {
            const res = await extractDocumentDraft<ConstructionContractDraft>("construction_contract", file);
            if (!res.ok) {
              toast.warning(res.warning || "AI 보완을 건너뛰었습니다. 직접 입력하세요.");
              return;
            }
            onDraft(res.draft || {});
            toast.success(res.warning ? `초안 입력 완료 (${res.warning})` : "계약 내용을 초안에 채웠습니다. 확인 후 저장하세요.");
          } finally {
            setLoading(false);
          }
        }}
      />
    </label>
  );
}
