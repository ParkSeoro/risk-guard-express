import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Image as ImageIcon, Paperclip, ExternalLink, Loader2 } from "lucide-react";
import { classifyAttachmentFile } from "@/lib/attachmentPreview";

type AttachmentRow = {
  id: string;
  name: string;
  description: string | null;
  category: string;
  is_mandatory: boolean;
  file_url: string | null;
  mime_type: string | null;
};

const CAT: Record<string, string> = {
  legal: "법정필수",
  calc_evidence: "계산근거",
  site_proof: "현장증빙",
};

function FileViewer({ row }: { row: AttachmentRow }) {
  const kind = classifyAttachmentFile({ url: row.file_url, mime: row.mime_type, name: row.name });
  const url = row.file_url!;
  if (kind === "image") {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        <img src={url} alt={row.name} className="max-h-[70vh] w-full object-contain rounded border bg-muted/30" />
      </a>
    );
  }
  if (kind === "pdf") {
    return (
      <iframe
        title={row.name}
        src={url}
        className="w-full h-[70vh] rounded border bg-white"
      />
    );
  }
  return (
    <div className="rounded border bg-muted/30 p-6 text-sm text-center space-y-2">
      <p className="text-muted-foreground">이 형식은 화면 안에 미리볼 수 없습니다.</p>
      <Button asChild variant="outline" size="sm">
        <a href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink className="h-3.5 w-3.5 mr-1" /> 새 창에서 열기
        </a>
      </Button>
    </div>
  );
}

/**
 * Reviewer surface: actual work_plan_attachments files inline (not legacy JSON).
 */
export default function AttachmentReviewPanel({ workPlanId }: { workPlanId: string }) {
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("work_plan_attachments")
        .select("id, name, description, category, is_mandatory, file_url, mime_type")
        .eq("work_plan_id", workPlanId)
        .eq("is_deleted", false)
        .order("is_mandatory", { ascending: false });
      if (cancelled) return;
      const next = (data || []) as AttachmentRow[];
      setRows(next);
      const first = next.find((r) => r.file_url) || null;
      setSelectedId(first?.id || null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [workPlanId]);

  const uploaded = useMemo(() => rows.filter((r) => !!r.file_url), [rows]);
  const selected = uploaded.find((r) => r.id === selectedId) || uploaded[0] || null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Paperclip className="h-4 w-4" /> 첨부파일 검토
          <Badge variant="outline" className="text-[10px] font-normal">
            {uploaded.length}/{rows.length} 첨부
          </Badge>
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          결재 검토용입니다. 왼쪽에서 고르면 PDF·이미지를 이 화면에서 바로 봅니다.
        </p>
      </CardHeader>
      <CardContent>
        {loading && (
          <div className="py-8 text-center text-muted-foreground text-sm">
            <Loader2 className="h-4 w-4 animate-spin inline mr-1" /> 첨부 불러오는 중…
          </div>
        )}
        {!loading && uploaded.length === 0 && (
          <p className="text-sm text-muted-foreground py-6 text-center">첨부된 파일이 없습니다.</p>
        )}
        {!loading && uploaded.length > 0 && (
          <div className="grid gap-3 md:grid-cols-[220px_1fr]">
            <ul className="space-y-1 max-h-[70vh] overflow-y-auto pr-1">
              {uploaded.map((row) => {
                const kind = classifyAttachmentFile({ url: row.file_url, mime: row.mime_type, name: row.name });
                const active = selected?.id === row.id;
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(row.id)}
                      className={`w-full text-left rounded border px-2 py-1.5 text-xs hover:bg-muted/50 ${
                        active ? "border-primary bg-primary/5" : "bg-card"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {kind === "image" ? <ImageIcon className="h-3.5 w-3.5 shrink-0" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
                        <span className="font-medium truncate">{row.name}</span>
                      </div>
                      <div className="flex gap-1 mt-0.5">
                        {CAT[row.category] && (
                          <Badge variant="outline" className="text-[9px] h-4">{CAT[row.category]}</Badge>
                        )}
                        {row.is_mandatory && (
                          <Badge variant="destructive" className="text-[9px] h-4">필수</Badge>
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
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{selected.name}</p>
                      {selected.description && (
                        <p className="text-[11px] text-muted-foreground">{selected.description}</p>
                      )}
                    </div>
                    <Button asChild size="sm" variant="outline" className="shrink-0">
                      <a href={selected.file_url!} target="_blank" rel="noopener noreferrer">
                        <ExternalLink className="h-3.5 w-3.5 mr-1" /> 새 창
                      </a>
                    </Button>
                  </div>
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
