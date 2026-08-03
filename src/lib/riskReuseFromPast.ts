/**
 * Reuse risk items from past approved assessment runs (company-scoped).
 * Speeds up auto-gen: pull known process rows, then AI fills gaps only.
 */
import { supabase } from "@/integrations/supabase/client";
import { filterRunsByCompanyScope } from "@/lib/companyDocScope";
import type { GeneratedRiskItem } from "@/lib/riskAutoGen";

export type PastRiskReuseOpts = {
  projectId: string;
  processName: string;
  /** null = all companies (master/owner); else allow-list */
  accessibleCompanyIds: string[] | null;
  userId?: string | null;
  /** Prefer runs targeting these companies */
  preferCompanyIds?: string[] | null;
  excludeRunId?: string | null;
  limit?: number;
};

function dedupeKey(process: string, subTask: string, hazard: string) {
  return `${(process || "").trim()}||${(subTask || "").trim()}||${(hazard || "").trim()}`.toLowerCase();
}

/** Map DB risk_items row → GeneratedRiskItem-shaped object for insert. */
export function mapRiskItemRowToGenerated(row: any): GeneratedRiskItem {
  return {
    process: row.process || "",
    sub_task: row.sub_task || "",
    hazard: row.hazard || "",
    hazard_situation: row.hazard_situation || "",
    existing_measure: row.existing_measure || "",
    improvement_measure: row.improvement_measure || "",
    frequency: row.frequency ?? 2,
    severity: row.severity ?? 2,
    improved_frequency: row.improved_frequency ?? 1,
    improved_severity: row.improved_severity ?? 1,
    likelihood_grade: row.likelihood_grade || "중",
    severity_grade: row.severity_grade || "중",
    risk_grade: row.risk_grade || "중",
    improved_likelihood_grade: row.improved_likelihood_grade || "하",
    improved_severity_grade: row.improved_severity_grade || "하",
    improved_risk_grade: row.improved_risk_grade || "하",
    ppe: Array.isArray(row.ppe) ? row.ppe : [],
    legal_basis: Array.isArray(row.legal_basis) ? row.legal_basis : [],
    department: row.department || "",
    assignee: row.assignee || "",
    status: "초안",
    tags: [],
  };
}

/**
 * Fetch deduped items for one process from approved runs in scope.
 */
export async function fetchPastApprovedRiskItems(
  opts: PastRiskReuseOpts,
): Promise<GeneratedRiskItem[]> {
  const limit = opts.limit ?? 40;
  const processName = (opts.processName || "").trim();
  if (!processName || !opts.projectId) return [];

  const { data: runsRaw, error: runsErr } = await supabase
    .from("assessment_runs")
    .select("id, created_by, target_company_ids, created_at")
    .eq("project_id", opts.projectId)
    .eq("status", "승인완료")
    .eq("is_deleted", false)
    .order("created_at", { ascending: false })
    .limit(40);

  if (runsErr || !runsRaw?.length) return [];

  let runs = filterRunsByCompanyScope(runsRaw as any[], {
    userId: opts.userId,
    accessibleCompanyIds: opts.accessibleCompanyIds,
  });

  if (opts.excludeRunId) {
    runs = runs.filter((r) => r.id !== opts.excludeRunId);
  }

  // Prefer runs that overlap target companies
  const prefer = new Set(opts.preferCompanyIds || []);
  if (prefer.size > 0) {
    runs = [...runs].sort((a, b) => {
      const ao = (a.target_company_ids || []).some((id: string) => prefer.has(id)) ? 0 : 1;
      const bo = (b.target_company_ids || []).some((id: string) => prefer.has(id)) ? 0 : 1;
      return ao - bo;
    });
  }

  const runIds = runs.map((r) => r.id).slice(0, 15);
  if (!runIds.length) return [];

  const { data: items, error: itemsErr } = await supabase
    .from("risk_items")
    .select(
      "process, sub_task, hazard, hazard_situation, existing_measure, improvement_measure, frequency, severity, improved_frequency, improved_severity, likelihood_grade, severity_grade, risk_grade, improved_likelihood_grade, improved_severity_grade, improved_risk_grade, ppe, legal_basis, department, assignee",
    )
    .in("run_id", runIds)
    .eq("process", processName)
    .eq("is_deleted", false)
    .eq("is_excluded", false)
    .limit(200);

  if (itemsErr || !items?.length) return [];

  const seen = new Set<string>();
  const out: GeneratedRiskItem[] = [];
  for (const row of items) {
    const g = mapRiskItemRowToGenerated(row);
    if (!g.sub_task) continue;
    const k = dedupeKey(g.process, g.sub_task, g.hazard);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(g);
    if (out.length >= limit) break;
  }
  return out;
}

export function filterDraftGaps(
  drafts: { sub_task: string; hazard: string }[],
  reused: { sub_task: string; hazard: string }[],
): { sub_task: string; hazard: string }[] {
  const seen = new Set(reused.map((r) => dedupeKey("", r.sub_task, r.hazard)));
  return drafts.filter((d) => {
    const k = dedupeKey("", d.sub_task, d.hazard);
    if (seen.has(k)) return false;
    seen.add(k);
    return Boolean((d.sub_task || "").trim());
  });
}
