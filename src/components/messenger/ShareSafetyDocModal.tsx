import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchShareableSafetyDocs } from "@/lib/messengerApi";
import type { SafetyDocCardPayload } from "@/lib/chatMessages";
import {
  ClipboardCheck,
  FileCheck2,
  Search,
  Send,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ShareSafetyDocModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId?: string | null;
  onSelectDoc: (doc: SafetyDocCardPayload) => void;
}

const KIND_LABELS: Record<SafetyDocCardPayload["kind"], string> = {
  work_permit: "작업허가서",
  assessment_run: "위험성평가",
  work_plan: "작업계획서",
  tbm_session: "TBM 일지",
};

export function ShareSafetyDocModal({
  isOpen,
  onClose,
  projectId,
  onSelectDoc,
}: ShareSafetyDocModalProps) {
  const [docs, setDocs] = useState<SafetyDocCardPayload[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterKind, setFilterKind] = useState<"all" | SafetyDocCardPayload["kind"]>("all");
  const [statusFilter, setStatusFilter] = useState<"pending" | "approved" | "all">("all");
  const [query, setQuery] = useState("");
  const [selectedDoc, setSelectedDoc] = useState<SafetyDocCardPayload | null>(null);
  const [note, setNote] = useState("");

  const isPendingStatus = (status?: string | null) => {
    const s = String(status || "").trim();
    return s === "검토중" || s === "대기" || s === "승인대기" || s === "결재대기" || s === "제출";
  };

  const isApprovedStatus = (status?: string | null) => {
    const s = String(status || "").trim();
    return s === "승인" || s === "승인완료" || s === "결재완료" || s === "완료";
  };

  useEffect(() => {
    if (!isOpen) {
      setSelectedDoc(null);
      setNote("");
      setQuery("");
      return;
    }
    setLoading(true);
    fetchShareableSafetyDocs(projectId)
      .then((res) => {
        // 작성중(미제출 초안)은 제외하고, 결재 대기 문서를 상단에 우선 배치
        const valid = res.filter((d) => String(d.statusLabel || "").trim() !== "작성중");
        valid.sort((a, b) => {
          const aPend = isPendingStatus(a.statusLabel) ? 0 : isApprovedStatus(a.statusLabel) ? 1 : 2;
          const bPend = isPendingStatus(b.statusLabel) ? 0 : isApprovedStatus(b.statusLabel) ? 1 : 2;
          return aPend - bPend;
        });
        setDocs(valid);
      })
      .finally(() => setLoading(false));
  }, [isOpen, projectId]);

  const filtered = useMemo(() => {
    return docs.filter((d) => {
      if (filterKind !== "all" && d.kind !== filterKind) return false;
      if (statusFilter === "pending" && !isPendingStatus(d.statusLabel)) return false;
      if (statusFilter === "approved" && !isApprovedStatus(d.statusLabel)) return false;
      if (!query.trim()) return true;
      const q = query.trim().toLowerCase();
      return (
        d.title.toLowerCase().includes(q) ||
        (d.subtitle || "").toLowerCase().includes(q)
      );
    });
  }, [docs, filterKind, statusFilter, query]);

  const handleConfirm = () => {
    if (!selectedDoc) return;
    onSelectDoc({
      ...selectedDoc,
      note: note.trim() || null,
    });
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-0 overflow-hidden bg-background">
        <DialogHeader className="p-4 border-b bg-muted/40">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            <FileCheck2 className="h-4 w-4 text-primary" />
            안전문서 카드로 공유하기
          </DialogTitle>
          <DialogDescription className="text-xs">
            결재 대기 문서는 <strong>검토·승인 요청</strong> 카드로, 승인 완료 문서는 <strong>현장 열람·공유</strong> 카드로 대화방에 전송합니다. (작성중인 임시 문서는 제외됩니다)
          </DialogDescription>
        </DialogHeader>

        <div className="p-4 space-y-3 flex-1 overflow-y-auto">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="문서명 또는 작업 위치 검색..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-8 text-xs h-8"
            />
          </div>

          <div className="flex items-center justify-between gap-1 flex-wrap">
            <div className="flex items-center gap-1 flex-wrap">
              {(
                [
                  { key: "all", label: "전체 문서" },
                  { key: "pending", label: "결재 대기(요청용)" },
                  { key: "approved", label: "승인 완료(공유용)" },
                ] as const
              ).map((st) => (
                <button
                  key={st.key}
                  type="button"
                  onClick={() => setStatusFilter(st.key)}
                  className={cn(
                    "text-[11px] px-2.5 py-1 rounded-md font-semibold transition-colors border",
                    statusFilter === st.key
                      ? "bg-primary/15 text-primary border-primary/40"
                      : "bg-background text-muted-foreground border-border hover:bg-muted",
                  )}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1 flex-wrap">
            {(
              [
                { key: "all", label: "전체" },
                { key: "work_permit", label: "작업허가서" },
                { key: "assessment_run", label: "위험성평가" },
                { key: "work_plan", label: "작업계획서" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setFilterKind(tab.key)}
                className={cn(
                  "text-[11px] px-2.5 py-1 rounded-full font-medium transition-colors",
                  filterKind === tab.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/60 text-muted-foreground hover:bg-muted",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="border rounded-lg divide-y max-h-56 overflow-y-auto bg-card">
            {loading ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                현장 안전문서를 불러오는 중...
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                공유 가능한 안전문서가 없습니다.
              </div>
            ) : (
              filtered.map((doc) => {
                const isSelected =
                  selectedDoc?.id === doc.id && selectedDoc?.kind === doc.kind;
                return (
                  <button
                    key={`${doc.kind}:${doc.id}`}
                    type="button"
                    onClick={() => setSelectedDoc(doc)}
                    className={cn(
                      "w-full text-left p-2.5 hover:bg-muted/50 transition-colors flex items-start justify-between gap-2",
                      isSelected && "bg-primary/10 hover:bg-primary/15",
                    )}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-primary/10 text-primary inline-flex items-center gap-1">
                          {doc.kind === "work_permit" ? (
                            <ShieldAlert className="h-2.5 w-2.5" />
                          ) : doc.kind === "assessment_run" ? (
                            <ClipboardCheck className="h-2.5 w-2.5" />
                          ) : (
                            <FileCheck2 className="h-2.5 w-2.5" />
                          )}
                          {KIND_LABELS[doc.kind]}
                        </span>
                        {doc.statusLabel && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground">
                            {doc.statusLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-xs font-semibold text-foreground truncate">
                        {doc.title}
                      </p>
                      {doc.subtitle && (
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                          {doc.subtitle}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {selectedDoc && (
            <div className="space-y-1.5 pt-1">
              <label className="text-[11px] font-medium text-muted-foreground">
                함께 보낼 코멘트 (선택)
              </label>
              <Input
                placeholder="예: 오후 크레인 인양 전 안전조치 확인 부탁드립니다."
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="h-8 text-xs"
              />
            </div>
          )}
        </div>

        <DialogFooter className="p-3 border-t bg-muted/20 flex gap-2 sm:justify-end">
          <Button type="button" variant="outline" size="sm" onClick={onClose} className="text-xs">
            취소
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!selectedDoc}
            onClick={handleConfirm}
            className="text-xs gap-1.5"
          >
            <Send className="h-3.5 w-3.5" />
            <span>대화방에 문서 공유</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
