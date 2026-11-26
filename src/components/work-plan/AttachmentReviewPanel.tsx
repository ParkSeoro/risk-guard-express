import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText,
  Image as ImageIcon,
  Paperclip,
  ExternalLink,
  Loader2,
  CheckCircle2,
  Copy,
  AlertTriangle,
  Sparkles,
  CalendarClock,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { formatAttachmentRevisionNote } from "@/lib/workPlanReviewSummary";
import {
  attachmentReviewEmptyState,
  classifyAttachmentFile,
  hasUploadedFile,
  pdfEmbedSrc,
  openAttachmentUrl,
} from "@/lib/attachmentPreview";
import {
  buildAttachmentOcrDbPatch,
  calcExpiryDaysRemaining,
  evaluateExpiryStatus,
  type WorkPlanAttachmentOcrMeta,
} from "@/lib/workPlanOcrHelpers";
import { analyzeWorkPlanAttachmentUrl } from "@/lib/workPlanOcrClient";
import { isNativeApp } from "@/lib/native/isNativeApp";

type AttachmentRow = {
  id: string;
  attachment_key?: string | null;
  name: string;
  description: string | null;
  category: string;
  is_mandatory: boolean;
  file_url: string | null;
  mime_type: string | null;
  ocr_meta?: WorkPlanAttachmentOcrMeta | null;
  doc_issue_date?: string | null;
  doc_expiry_date?: string | null;
  ocr_checked_at?: string | null;
};

const CAT: Record<string, string> = {
  legal: "법정필수",
  calc_evidence: "계산근거",
  site_proof: "현장증빙",
};

function ExpiryBadge({ expiryDate }: { expiryDate?: string | null }) {
  if (!expiryDate) return null;
  const status = evaluateExpiryStatus(expiryDate);
  const days = calcExpiryDaysRemaining(expiryDate);
  if (status === "expired") {
    return (
      <Badge variant="destructive" className="text-[9px] h-4 gap-0.5">
        <AlertTriangle className="h-2.5 w-2.5" /> 만료 ({expiryDate})
      </Badge>
    );
  }
  if (status === "expiring_soon") {
    return (
      <Badge variant="outline" className="text-[9px] h-4 border-amber-500 text-amber-700 dark:text-amber-300">
        임박 {days != null ? `D-${days}` : ""} ({expiryDate})
      </Badge>
    );
  }
  if (status === "valid") {
    return (
      <Badge variant="outline" className="text-[9px] h-4 border-emerald-500/40 text-emerald-700 dark:text-emerald-300">
        유효 ~{expiryDate}
      </Badge>
    );
  }
  return null;
}

function FileViewer({ row }: { row: AttachmentRow }) {
  const kind = classifyAttachmentFile({ url: row.file_url, mime: row.mime_type, name: row.name });
  const url = row.file_url!;
  if (kind === "image") {
    return (
      <button
        type="button"
        className="block w-full"
        onClick={() => openAttachmentUrl(url)}
      >
        <img src={url} alt={row.name} className="max-h-[70vh] w-full object-contain rounded border bg-muted/30" />
      </button>
    );
  }
  if (kind === "pdf") {
    if (isNativeApp()) {
      return (
        <div className="rounded border bg-muted/30 p-6 text-sm text-center space-y-3">
          <p className="text-muted-foreground">
            앱 화면 안에서는 PDF를 바로 그릴 수 없습니다. 기기 뷰어로 열어 주세요.
          </p>
          <Button type="button" onClick={() => openAttachmentUrl(url)}>
            <ExternalLink className="h-3.5 w-3.5 mr-1" /> 파일 열기
          </Button>
        </div>
      );
    }
    const src = pdfEmbedSrc(url);
    return (
      <object data={src} type="application/pdf" className="w-full h-[70vh] rounded border bg-white">
        <iframe title={row.name} src={src} className="w-full h-[70vh] rounded border bg-white" />
      </object>
    );
  }
  return (
    <div className="rounded border bg-muted/30 p-6 text-sm text-center space-y-2">
      <p className="text-muted-foreground">이 형식은 화면 안에 미리볼 수 없습니다.</p>
      <Button type="button" variant="outline" size="sm" onClick={() => openAttachmentUrl(url)}>
        <ExternalLink className="h-3.5 w-3.5 mr-1" /> 새 창에서 열기
      </Button>
    </div>
  );
}

/**
 * Reviewer / author surface: actual work_plan_attachments files inline
 * (legacy work_plans.attachments JSON is empty and must not be used).
 */
export default function AttachmentReviewPanel({
  workPlanId,
  reviewerMode = false,
  compact = false,
  onOcrUpdated,
}: {
  workPlanId: string;
  reviewerMode?: boolean;
  compact?: boolean;
  onOcrUpdated?: () => void;
}) {
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [checkedIds, setCheckedIds] = useState<Record<string, boolean>>({});
  const [scanningOcr, setScanningOcr] = useState(false);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    setCheckedIds({});
  }, [workPlanId]);

  const toggleChecked = (id: string) => {
    setCheckedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyRevisionNote = async (row: AttachmentRow) => {
    const expiryStatus = evaluateExpiryStatus(row.doc_expiry_date);
    const reason =
      expiryStatus === "expired" && row.doc_expiry_date
        ? `유효기간 만료 (${row.doc_expiry_date}) — 최신 서류로 재첨부해 주세요.`
        : expiryStatus === "expiring_soon" && row.doc_expiry_date
          ? `유효기간 임박 (${row.doc_expiry_date}) — 작업기간 내 유효 여부를 확인해 주세요.`
          : undefined;
    const note = formatAttachmentRevisionNote(row.name, reason);
    try {
      await navigator.clipboard.writeText(note);
      toast({
        title: "보완 요청 문구 복사됨",
        description: "결재 의견·반려 사유 칸에 바로 붙여넣기(Ctrl+V)하세요.",
      });
    } catch {
      toast({ title: "보완 요청 문구", description: note });
    }
  };

  const fetchRows = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from("work_plan_attachments")
      .select(
        "id, attachment_key, name, description, category, is_mandatory, file_url, mime_type, ocr_meta, doc_issue_date, doc_expiry_date, ocr_checked_at",
      )
      .eq("work_plan_id", workPlanId)
      .eq("is_deleted", false)
      .order("is_mandatory", { ascending: false })
      .order("name", { ascending: true });
    if (queryError) {
      setRows([]);
      setSelectedId(null);
      setError(queryError.message || "첨부를 불러오지 못했습니다.");
      setLoading(false);
      return;
    }
    const next = (data || []) as unknown as AttachmentRow[];
    setRows(next);
    setSelectedId((prev) => {
      if (prev && next.some((r) => r.id === prev && hasUploadedFile(r.file_url))) return prev;
      return next.find((r) => hasUploadedFile(r.file_url))?.id || null;
    });
    setLoading(false);
  }, [workPlanId]);

  useEffect(() => {
    void fetchRows();
  }, [fetchRows]);

  const uploaded = useMemo(() => rows.filter((r) => hasUploadedFile(r.file_url)), [rows]);
  const uncheckedOcrRows = useMemo(
    () => uploaded.filter((r) => !r.ocr_checked_at),
    [uploaded],
  );
  const expiredRows = useMemo(
    () => uploaded.filter((r) => evaluateExpiryStatus(r.doc_expiry_date) === "expired"),
    [uploaded],
  );
  const expiringSoonRows = useMemo(
    () => uploaded.filter((r) => evaluateExpiryStatus(r.doc_expiry_date) === "expiring_soon"),
    [uploaded],
  );
  const checkedCount = useMemo(
    () => uploaded.filter((r) => !!checkedIds[r.id]).length,
    [uploaded, checkedIds],
  );
  const selected = uploaded.find((r) => r.id === selectedId) || uploaded[0] || null;
  const empty = attachmentReviewEmptyState({
    error,
    uploadedCount: uploaded.length,
    slotCount: rows.length,
  });

  const runBatchAiReview = async () => {
    if (scanningOcr || uploaded.length === 0) return;
    const targets = uncheckedOcrRows.length > 0 ? uncheckedOcrRows : uploaded;
    setScanningOcr(true);
    setScanProgress({ done: 0, total: targets.length });
    let detectedExpiryCount = 0;
    let detectedExpiredCount = 0;
    const localUpdates = new Map<string, ReturnType<typeof buildAttachmentOcrDbPatch>>();

    try {
      for (let i = 0; i < targets.length; i += 1) {
        const row = targets[i];
        if (!row.file_url) continue;
        const ocr = await analyzeWorkPlanAttachmentUrl({
          fileUrl: row.file_url,
          fileName: row.name,
          mimeType: row.mime_type,
          availableSlots: [{ key: row.attachment_key || row.id, name: row.name }],
        });
        const patch = buildAttachmentOcrDbPatch(ocr);
        if (patch) {
          localUpdates.set(row.id, patch);
          if (patch.doc_expiry_date) {
            detectedExpiryCount += 1;
            if (evaluateExpiryStatus(patch.doc_expiry_date) === "expired") {
              detectedExpiredCount += 1;
            }
          }
          // Best-effort persist to DB (even if reviewer lacks update RLS, local state still updates)
          await supabase
            .from("work_plan_attachments")
            .update(patch as any)
            .eq("id", row.id);
        }
        setScanProgress({ done: i + 1, total: targets.length });
      }

      if (localUpdates.size > 0) {
        setRows((prev) =>
          prev.map((r) => {
            const patch = localUpdates.get(r.id);
            return patch ? { ...r, ...patch } : r;
          }),
        );
        onOcrUpdated?.();
      }

      toast({
        title:
          detectedExpiredCount > 0
            ? `⚠️ AI 기간 검토 완료 — 만료 서류 ${detectedExpiredCount}건 감지`
            : `AI 기간 검토 완료 (${targets.length}건 확인)`,
        description:
          detectedExpiryCount > 0
            ? `유효기간 확인 ${detectedExpiryCount}건 (만료 ${detectedExpiredCount}건)`
            : "문서에서 명시된 유효기간이 발견되지 않았습니다.",
        variant: detectedExpiredCount > 0 ? "destructive" : "default",
      });
    } finally {
      setScanningOcr(false);
      setScanProgress(null);
    }
  };

  return (
    <Card className={compact ? "border-0 shadow-none" : undefined}>
      <CardHeader className={compact ? "px-3 py-2" : "pb-2"}>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
            <Paperclip className="h-4 w-4" /> 첨부파일
            <Badge variant="outline" className="text-[10px] font-normal">
              {uploaded.length}/{rows.length} 첨부
            </Badge>
            {reviewerMode && uploaded.length > 0 && (
              <Badge
                variant={checkedCount === uploaded.length ? "default" : "secondary"}
                className="text-[10px] font-normal gap-1"
              >
                <CheckCircle2 className="h-3 w-3" /> 검토 확인 {checkedCount}/{uploaded.length}
              </Badge>
            )}
          </CardTitle>
          {uploaded.length > 0 && (
            <Button
              type="button"
              size="sm"
              variant={uncheckedOcrRows.length > 0 ? "default" : "outline"}
              className="h-7 text-[11px] gap-1 shrink-0"
              disabled={scanningOcr}
              onClick={() => void runBatchAiReview()}
              title="검사유효기간·보험기간·면허만료일을 AI로 자동 판독합니다"
            >
              {scanningOcr ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  판독 중 {scanProgress ? `(${scanProgress.done}/${scanProgress.total})` : "…"}
                </>
              ) : (
                <>
                  <Sparkles className="h-3 w-3" />
                  {uncheckedOcrRows.length > 0
                    ? `AI 기간 검토 (${uncheckedOcrRows.length}건)`
                    : "AI 기간 재검토"}
                </>
              )}
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          {reviewerMode
            ? "서류를 클릭해 원본과 검사·보험 유효기간을 확인하고, 확인 체크 또는 보완 요청 문구를 복사하세요."
            : "작성 중에도 올린 PDF·이미지를 이 화면에서 바로 봅니다. 왼쪽에서 서류를 고르세요."}
        </p>

        {expiredRows.length > 0 && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive flex items-start gap-1.5 mt-1">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <div>
              <b>유효기간 만료 서류 {expiredRows.length}건 감지</b>:{" "}
              {expiredRows.map((r) => `${r.name}(${r.doc_expiry_date})`).join(", ")}
            </div>
          </div>
        )}
        {expiredRows.length === 0 && expiringSoonRows.length > 0 && (
          <div className="rounded-md border border-amber-500/50 bg-amber-50/80 dark:bg-amber-950/30 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-200 flex items-start gap-1.5 mt-1">
            <CalendarClock className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <div>
              <b>30일 이내 만료 임박 {expiringSoonRows.length}건</b>:{" "}
              {expiringSoonRows.map((r) => `${r.name}(${r.doc_expiry_date})`).join(", ")}
            </div>
          </div>
        )}
      </CardHeader>
      <CardContent className={compact ? "px-3 pb-3" : undefined}>
        {loading && (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> 첨부 불러오는 중…
          </div>
        )}
        {!loading && empty && (
          <p className={`text-sm py-6 text-center ${empty.kind === "error" ? "text-destructive" : "text-muted-foreground"}`}>
            {empty.message}
          </p>
        )}
        {!loading && !empty && (
          <div className={compact ? "space-y-3" : "grid gap-3 md:grid-cols-[260px_1fr]"}>
            <ul className={compact ? "space-y-1 max-h-48 overflow-y-auto pr-1" : "space-y-1 max-h-[70vh] overflow-y-auto pr-1"}>
              {rows.map((row) => {
                const hasFile = hasUploadedFile(row.file_url);
                const kind = classifyAttachmentFile({ url: row.file_url, mime: row.mime_type, name: row.name });
                const active = selected?.id === row.id;
                const isChecked = !!checkedIds[row.id];
                const isExpired = hasFile && evaluateExpiryStatus(row.doc_expiry_date) === "expired";
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      disabled={!hasFile}
                      onClick={() => hasFile && setSelectedId(row.id)}
                      className={`w-full text-left rounded border px-2 py-1.5 text-xs ${
                        !hasFile
                          ? "opacity-60 cursor-not-allowed bg-muted/20"
                          : isExpired
                            ? active
                              ? "border-destructive bg-destructive/10"
                              : "border-destructive/40 bg-destructive/5 hover:bg-destructive/10"
                            : active
                              ? "border-primary bg-primary/5"
                              : "bg-card hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {reviewerMode && isChecked
                          ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                          : kind === "image"
                            ? <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                            : <FileText className="h-3.5 w-3.5 shrink-0" />}
                        <span className="font-medium truncate">{row.name}</span>
                      </div>
                      <div className="flex gap-1 mt-0.5 flex-wrap">
                        {CAT[row.category] && (
                          <Badge variant="outline" className="text-[9px] h-4">{CAT[row.category]}</Badge>
                        )}
                        {row.is_mandatory && (
                          <Badge variant="destructive" className="text-[9px] h-4">필수</Badge>
                        )}
                        {!hasFile && (
                          <Badge variant="secondary" className="text-[9px] h-4">미첨부</Badge>
                        )}
                        {hasFile && <ExpiryBadge expiryDate={row.doc_expiry_date} />}
                        {reviewerMode && isChecked && (
                          <Badge variant="outline" className="text-[9px] h-4 border-success text-success">확인됨</Badge>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="min-w-0 space-y-2">
              {selected && (
                <>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{selected.name}</p>
                      {selected.description && (
                        <p className="text-[11px] text-muted-foreground">{selected.description}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                      {reviewerMode && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant={checkedIds[selected.id] ? "default" : "outline"}
                            className="h-7 text-[11px] gap-1"
                            onClick={() => toggleChecked(selected.id)}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {checkedIds[selected.id] ? "확인 완료" : "확인 ✓"}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 text-[11px] gap-1"
                            onClick={() => void copyRevisionNote(selected)}
                          >
                            <Copy className="h-3.5 w-3.5" /> 보완 요청 복사
                          </Button>
                        </>
                      )}
                      <Button type="button" size="sm" variant="outline" className="h-7 text-[11px] shrink-0" onClick={() => openAttachmentUrl(selected.file_url!)}>
                        <ExternalLink className="h-3.5 w-3.5 mr-1" /> 새 창
                      </Button>
                    </div>
                  </div>
                  {(selected.doc_expiry_date || selected.ocr_meta) && (
                    <div className="rounded-md border bg-muted/20 px-2.5 py-2 text-[11px] space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-semibold text-foreground">AI 판독 요약</span>
                        {selected.ocr_meta?.docCategoryLabel && (
                          <Badge variant="outline" className="text-[9px] h-4">
                            {selected.ocr_meta.docCategoryLabel}
                          </Badge>
                        )}
                        <ExpiryBadge expiryDate={selected.doc_expiry_date} />
                        {selected.doc_issue_date && (
                          <span className="text-muted-foreground">발급: {selected.doc_issue_date}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-x-3 gap-y-0.5 flex-wrap text-muted-foreground">
                        {selected.ocr_meta?.companyOrHolder && (
                          <span>대상: <b className="text-foreground">{selected.ocr_meta.companyOrHolder}</b></span>
                        )}
                        {selected.ocr_meta?.regOrCertNo && (
                          <span>번호: <b className="text-foreground">{selected.ocr_meta.regOrCertNo}</b></span>
                        )}
                        {selected.ocr_meta?.ratedCapacityTon != null && (
                          <span>정격하중: <b className="text-foreground">{selected.ocr_meta.ratedCapacityTon}t</b></span>
                        )}
                      </div>
                      {selected.ocr_meta?.summary && (
                        <p className="text-muted-foreground">{selected.ocr_meta.summary}</p>
                      )}
                    </div>
                  )}
                  <FileViewer row={selected} />
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
