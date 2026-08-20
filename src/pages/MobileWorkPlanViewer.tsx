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
  A4_PORTRAIT_PX,
  fetchWorkPlanPrintHtml,
} from "@/lib/approvalDocPreview";
import { extractWorkPlanHazardCards, type WorkPlanHazardCard } from "@/lib/workPlanHazardCards";

/**
 * Mobile read-only viewer for work plans (including in-approval docs).
 * Print-HTML preview with pinch-zoom + large-type hazard summary.
 */
export default function MobileWorkPlanViewer({ planId: propPlanId }: { planId?: string } = {}) {
  const params = useParams<{ planId: string }>();
  const planId = propPlanId || params.planId;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<any>(null);
  const [cards, setCards] = useState<WorkPlanHazardCard[]>([]);
  const [printHtml, setPrintHtml] = useState<string | null>(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);

  const goBack = () => {
    const back = resolvePermitViewerBackPath(searchParams.get("from"));
    if (back) navigate(back);
    else navigate(-1);
  };

  useEffect(() => {
    if (!planId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setPrintHtml(null);
      setPrintError(null);
      const { data, error } = await supabase.from("work_plans").select("*").eq("id", planId).maybeSingle();
      if (cancelled) return;
      if (error || !data || data.is_deleted) {
        toast.error("작업계획서를 불러올 수 없습니다");
        setLoading(false);
        return;
      }
      setPlan(data);
      const sections = Array.isArray(data.sections) ? data.sections : [];
      let extracted = extractWorkPlanHazardCards(sections);

      if (extracted.length === 0 && data.project_id) {
        let runId = data.assessment_run_id as string | null;
        if (!runId) {
          const { data: runs } = await supabase
            .from("assessment_runs")
            .select("id")
            .eq("project_id", data.project_id)
            .eq("status", "승인완료")
            .eq("is_deleted", false)
            .order("updated_at", { ascending: false })
            .limit(1);
          runId = runs?.[0]?.id || null;
        }
        if (runId) {
          const { data: items } = await supabase
            .from("risk_items")
            .select("id, process, sub_task, hazard, improvement_measure, existing_measure, risk_grade")
            .eq("run_id", runId)
            .eq("is_deleted", false);
          const high = (items || []).filter((x: any) =>
            ["상", "high", "H", "3"].includes(String(x.risk_grade || "").trim()),
          );
          extracted = high.map((h: any) => ({
            key: h.id,
            process: `${h.process || "-"}${h.sub_task ? ` / ${h.sub_task}` : ""}`,
            hazard: h.hazard || "(위험요인)",
            measure: h.improvement_measure || h.existing_measure || "안전조치 미기재",
          }));
        }
      }
      if (cancelled) return;
      setCards(extracted);
      setLoading(false);

      setPrintLoading(true);
      try {
        const html = await fetchWorkPlanPrintHtml(planId);
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
  }, [planId]);

  return (
    <div className="h-dvh overflow-hidden bg-slate-950 text-white flex flex-col">
      <header className="shrink-0 bg-sky-800 px-4 py-3 flex items-center gap-3 shadow-lg">
        <Button
          size="icon"
          variant="ghost"
          className="text-white hover:bg-sky-700"
          onClick={goBack}
        >
          <ArrowLeft className="h-6 w-6" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-sky-100">작업계획서 · 문서 보기</div>
          <div className="font-bold text-lg truncate leading-snug">{plan?.title || "작업계획"}</div>
        </div>
        {plan && <Badge className="bg-white/20 text-white border-0 shrink-0">{plan.status}</Badge>}
      </header>

      <Tabs defaultValue="doc" className="flex-1 min-h-0 flex flex-col">
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
            pageWidth={A4_PORTRAIT_PX}
            emptyHint="인쇄 문서를 표시할 수 없습니다"
          />
        </TabsContent>

        <TabsContent value="summary" className="flex-1 min-h-0 mt-0 overflow-y-auto px-4 py-4 space-y-4">
          {plan && (
            <div className="rounded-xl bg-slate-900 border border-slate-700 p-4 text-sm space-y-1">
              <div className="flex gap-2 flex-wrap">
                {plan.work_type && <Badge variant="outline" className="border-slate-500 text-slate-200">{plan.work_type}</Badge>}
                <span className="text-slate-400">
                  {plan.start_date || "—"} ~ {plan.end_date || "—"}
                </span>
              </div>
            </div>
          )}

          {loading && (
            <div className="text-center py-16 text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin inline" />
            </div>
          )}

          {!loading && cards.length === 0 && (
            <div className="text-center py-16 text-slate-400 text-base">표시할 핵심 위험요인이 없습니다</div>
          )}

          <p className="text-xs text-slate-400">작성·수정은 PC에서만 가능합니다.</p>

          {cards.map((c) => (
            <article key={c.key} className="rounded-2xl bg-slate-900 border border-slate-700 overflow-hidden shadow-xl">
              <div className="p-5 space-y-2 border-b border-slate-700">
                {c.process && <div className="text-xs text-slate-400">{c.process}</div>}
                <h2 className="text-2xl font-black leading-snug text-amber-300 flex gap-2 items-start">
                  <AlertTriangle className="h-6 w-6 shrink-0 mt-1" />
                  <span>{c.hazard}</span>
                </h2>
              </div>
              <div className="bg-emerald-950/60 p-5 space-y-2">
                <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm uppercase tracking-wide">
                  <ShieldCheck className="h-5 w-5" /> 안전조치
                </div>
                <p className="text-xl font-semibold leading-relaxed text-emerald-50 whitespace-pre-wrap">{c.measure}</p>
              </div>
            </article>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
