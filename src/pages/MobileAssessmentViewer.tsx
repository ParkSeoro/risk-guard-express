import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, AlertTriangle, ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import ZoomableDocumentPreview from "@/components/docs/ZoomableDocumentPreview";
import { resolvePermitViewerBackPath } from "@/lib/permitViewerNav";
import {
  A4_LANDSCAPE_PX,
  fetchAssessmentPrintHtml,
} from "@/lib/approvalDocPreview";

type RiskCard = {
  id: string;
  process: string;
  sub_task: string | null;
  hazard: string | null;
  hazard_situation: string | null;
  existing_measure: string | null;
  improvement_measure: string | null;
  risk_grade: string;
  ppe: string[] | null;
};

const GRADE_STYLE: Record<string, string> = {
  상: "bg-red-600 text-white",
  high: "bg-red-600 text-white",
  H: "bg-red-600 text-white",
  중: "bg-amber-500 text-white",
  medium: "bg-amber-500 text-white",
  M: "bg-amber-500 text-white",
  하: "bg-emerald-600 text-white",
  low: "bg-emerald-600 text-white",
  L: "bg-emerald-600 text-white",
};

/**
 * Mobile read-only viewer for risk assessments (including in-approval docs).
 * Print-HTML preview with pinch-zoom + large-type hazard summary.
 */
export default function MobileAssessmentViewer({ runId: propRunId }: { runId?: string } = {}) {
  const params = useParams<{ runId: string }>();
  const runId = propRunId || params.runId;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState<{ period_label: string | null; type: string; status: string } | null>(null);
  const [items, setItems] = useState<RiskCard[]>([]);
  const [printHtml, setPrintHtml] = useState<string | null>(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [tab, setTab] = useState<"doc" | "summary">("doc");

  const goBack = () => {
    const back = resolvePermitViewerBackPath(searchParams.get("from"));
    if (back) navigate(back);
    else navigate(-1);
  };

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setPrintHtml(null);
      setPrintError(null);
      const { data: run, error } = await supabase
        .from("assessment_runs")
        .select("id, period_label, type, status, is_deleted")
        .eq("id", runId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !run || run.is_deleted) {
        toast.error("평가를 불러올 수 없습니다");
        setLoading(false);
        return;
      }
      setMeta({ period_label: run.period_label, type: run.type, status: run.status });
      const { data: rows } = await supabase
        .from("risk_items")
        .select(
          "id, process, sub_task, hazard, hazard_situation, existing_measure, improvement_measure, risk_grade, ppe",
        )
        .eq("run_id", runId)
        .eq("is_deleted", false)
        .order("sort_order");
      if (cancelled) return;
      const sorted = [...(rows || [])].sort((a: any, b: any) => {
        const score = (g: string) => {
          const s = (g || "").toLowerCase();
          if (s.includes("상") || s === "high" || s === "h" || s === "3") return 0;
          if (s.includes("중") || s === "medium" || s === "m" || s === "2") return 1;
          return 2;
        };
        return score(a.risk_grade) - score(b.risk_grade);
      });
      setItems(sorted as RiskCard[]);
      setLoading(false);

      setPrintLoading(true);
      try {
        const html = await fetchAssessmentPrintHtml(runId);
        if (!cancelled) setPrintHtml(html);
      } catch (e: any) {
        if (!cancelled) setPrintError(e?.message || "인쇄 문서를 불러오지 못했습니다");
      } finally {
        if (!cancelled) setPrintLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  return (
    <div className="h-dvh overflow-hidden bg-slate-950 text-white flex flex-col">
      <header className="shrink-0 bg-red-700 px-4 py-3 flex items-center gap-3 shadow-lg">
        <Button
          size="icon"
          variant="ghost"
          className="text-white hover:bg-red-600"
          onClick={goBack}
        >
          <ArrowLeft className="h-6 w-6" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-red-100">위험성평가 · 문서 보기</div>
          <div className="font-bold text-lg truncate">{meta?.period_label || "위험성평가"}</div>
        </div>
        {meta && (
          <Badge className="bg-white/20 text-white border-0 shrink-0">{meta.status}</Badge>
        )}
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "doc" | "summary")} className="flex-1 min-h-0 flex flex-col">
        <TabsList className="shrink-0 mx-3 mt-2 grid grid-cols-2 bg-slate-800 text-slate-300">
          <TabsTrigger value="doc" className="data-[state=active]:bg-white data-[state=active]:text-slate-900">
            문서
          </TabsTrigger>
          <TabsTrigger value="summary" className="data-[state=active]:bg-white data-[state=active]:text-slate-900">
            요약
          </TabsTrigger>
        </TabsList>

        <TabsContent value="doc" forceMount className="flex-1 min-h-0 mt-2 data-[state=inactive]:hidden">
          <ZoomableDocumentPreview
            html={printHtml}
            loading={printLoading || loading}
            error={printError}
            pageWidth={A4_LANDSCAPE_PX}
            emptyHint="인쇄 문서를 표시할 수 없습니다"
            active={tab === "doc"}
          />
        </TabsContent>

        <TabsContent value="summary" className="flex-1 min-h-0 mt-0 overflow-y-auto px-4 py-4 space-y-4">
          {loading && (
            <div className="text-center py-16 text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin inline" />
            </div>
          )}

          {!loading && items.length === 0 && (
            <div className="text-center py-16 text-slate-400 text-base">등록된 위험요인이 없습니다</div>
          )}

          <p className="text-xs text-slate-400">작성·수정은 PC에서만 가능합니다.</p>

          {items.map((it) => {
            const measure = it.improvement_measure || it.existing_measure || "안전조치 미기재";
            const gradeClass = GRADE_STYLE[it.risk_grade] || GRADE_STYLE[(it.risk_grade || "").toLowerCase()] || "bg-slate-600 text-white";
            return (
              <article
                key={it.id}
                className="rounded-2xl bg-slate-900 border border-slate-700 overflow-hidden shadow-xl"
              >
                <div className="flex items-stretch">
                  <div className={`px-3 py-4 flex items-center justify-center font-black text-xl min-w-[3.5rem] ${gradeClass}`}>
                    {it.risk_grade || "—"}
                  </div>
                  <div className="flex-1 p-4 space-y-1">
                    <div className="text-xs text-slate-400">
                      {it.process}
                      {it.sub_task ? ` · ${it.sub_task}` : ""}
                    </div>
                    <h2 className="text-2xl font-black leading-snug text-red-300 flex gap-2 items-start">
                      <AlertTriangle className="h-6 w-6 shrink-0 mt-1" />
                      <span>{it.hazard || "(위험요인 미기재)"}</span>
                    </h2>
                    {it.hazard_situation && (
                      <p className="text-sm text-slate-300 leading-relaxed">{it.hazard_situation}</p>
                    )}
                  </div>
                </div>
                <div className="bg-emerald-950/60 border-t border-emerald-800/60 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm uppercase tracking-wide">
                    <ShieldCheck className="h-5 w-5" /> 안전조치
                  </div>
                  <p className="text-xl font-semibold leading-relaxed text-emerald-50 whitespace-pre-wrap">
                    {measure}
                  </p>
                  {it.ppe && it.ppe.length > 0 && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {it.ppe.map((p) => (
                        <span key={p} className="rounded-lg bg-emerald-800/50 px-2.5 py-1 text-xs text-emerald-100">
                          {p}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </TabsContent>
      </Tabs>
    </div>
  );
}
