import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, AlertTriangle, ShieldCheck, Loader2, FileText } from "lucide-react";
import { toast } from "sonner";

type HazardCard = {
  key: string;
  hazard: string;
  measure: string;
  process?: string;
};

function extractHazardCards(sections: any[]): HazardCard[] {
  const cards: HazardCard[] = [];
  const ra = (sections || []).find((s: any) => s.key === "_ra_high_risks");
  if (ra?.content && typeof ra.content === "string") {
    const blocks = ra.content.split(/\n• /).map((b: string, i: number) => (i === 0 ? b.replace(/^• /, "") : b));
    for (const block of blocks) {
      const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      const head = lines[0];
      const measureLine = lines.find((l) => l.startsWith("→")) || lines[1] || "";
      const m = head.match(/^\[(.+?)\]\s*(.*)$/);
      cards.push({
        key: `ra-${cards.length}`,
        process: m?.[1],
        hazard: (m?.[2] || head).trim() || "(위험요인)",
        measure: measureLine.replace(/^→\s*/, "").trim() || "안전조치 미기재",
      });
    }
  }

  for (const s of sections || []) {
    if (!s || s.key === "_ra_high_risks" || s.key === "_checklist") continue;
    const title = String(s.title || s.key || "");
    const content = typeof s.content === "string" ? s.content.trim() : "";
    if (!content) continue;
    const isHazard =
      /위험|hazard|안전조치|대책|예방|주의/i.test(title) ||
      s.key === "risk" ||
      s.key === "safety" ||
      s.key === "measures";
    if (isHazard) {
      cards.push({
        key: `sec-${s.key}`,
        hazard: title,
        measure: content,
      });
    }
  }
  return cards;
}

/**
 * Mobile read-only viewer for approved work plans.
 * Surfaces key hazards & safety measures as large cards.
 */
export default function MobileWorkPlanViewer({ planId: propPlanId }: { planId?: string } = {}) {
  const params = useParams<{ planId: string }>();
  const planId = propPlanId || params.planId;
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<any>(null);
  const [cards, setCards] = useState<HazardCard[]>([]);

  useEffect(() => {
    if (!planId) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from("work_plans").select("*").eq("id", planId).maybeSingle();
      if (error || !data || data.is_deleted) {
        toast.error("작업계획서를 불러올 수 없습니다");
        setLoading(false);
        return;
      }
      setPlan(data);
      if (data.status !== "승인완료") {
        setCards([]);
        setLoading(false);
        return;
      }
      const sections = Array.isArray(data.sections) ? data.sections : [];
      let extracted = extractHazardCards(sections);

      // Fallback: pull high-risk items from linked / latest approved assessment
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
            ["상", "high", "H", "3"].includes(String(x.risk_grade || "").trim())
          );
          extracted = high.map((h: any) => ({
            key: h.id,
            process: `${h.process || "-"}${h.sub_task ? ` / ${h.sub_task}` : ""}`,
            hazard: h.hazard || "(위험요인)",
            measure: h.improvement_measure || h.existing_measure || "안전조치 미기재",
          }));
        }
      }
      setCards(extracted);
      setLoading(false);
    })();
  }, [planId]);

  return (
    <div className="min-h-screen bg-slate-950 text-white pb-24">
      <header className="sticky top-0 z-10 bg-sky-800 px-4 py-4 flex items-center gap-3 shadow-lg">
        <Button
          size="icon"
          variant="ghost"
          className="text-white hover:bg-sky-700"
          onClick={() => navigate(-1)}
        >
          <ArrowLeft className="h-6 w-6" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-wide text-sky-100">작업계획서 · 조회 전용</div>
          <div className="font-bold text-lg truncate leading-snug">{plan?.title || "작업계획"}</div>
        </div>
        {plan && <Badge className="bg-white/20 text-white border-0 shrink-0">{plan.status}</Badge>}
      </header>

      <main className="px-4 py-5 space-y-4 max-w-lg mx-auto">
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

        {!loading && plan?.status !== "승인완료" && (
          <div className="rounded-2xl bg-slate-800 p-6 text-center space-y-2">
            <FileText className="h-10 w-10 text-amber-400 mx-auto" />
            <p className="text-lg font-semibold">승인 완료된 계획서만 조회됩니다</p>
            <p className="text-sm text-slate-400">작성·수정은 PC에서만 가능합니다.</p>
          </div>
        )}

        {!loading && plan?.status === "승인완료" && cards.length === 0 && (
          <div className="text-center py-16 text-slate-400 text-base">표시할 핵심 위험요인이 없습니다</div>
        )}

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
      </main>
    </div>
  );
}
