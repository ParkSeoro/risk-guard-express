/**
 * Shared AI response cache helpers for Deno edge functions.
 * Prefer approved library / prior approved cache before calling the LLM.
 */

export function buildRiskCacheKey(parts: {
  process_name: string;
  equipment: string;
  work_description: string;
  work_location: string;
  work_environment: string;
  detailLevel: string;
}) {
  return `v5|${parts.process_name}|${parts.equipment}|${parts.work_description}|${parts.work_location}|${parts.work_environment}|${parts.detailLevel}`
    .toLowerCase()
    .trim();
}

export function buildAccidentCacheKey(parts: {
  process_name: string;
  equipment?: string;
  work_description?: string;
}) {
  return `acc_v1|${parts.process_name}|${parts.equipment || ""}|${parts.work_description || ""}`
    .toLowerCase()
    .trim();
}

/** Map standard_risk_library rows → risk item shape (cache-hit without LLM). */
export function libraryRowsToRiskItems(rows: any[], processName: string): any[] {
  const out: any[] = [];
  for (const r of rows || []) {
    const hazard = String(r.hazard || r.hazard_factor || r.title || "").trim();
    if (!hazard) continue;
    out.push({
      process_name: processName,
      work_phase: r.work_phase || r.phase || "공통",
      hazard,
      cause: r.cause || r.root_cause || "",
      likelihood: r.likelihood ?? r.freq ?? 2,
      severity: r.severity ?? r.severity_level ?? 3,
      reduction_measures: r.reduction_measures || r.countermeasure || r.measure || "",
      source: "library",
      library_id: r.id || null,
    });
  }
  return out;
}

export async function fetchApprovedLibraryRisks(
  adminClient: any,
  processName: string,
  limit = 24,
): Promise<any[]> {
  if (!processName) return [];
  // Prefer exact process match on approved/active library rows
  let q = adminClient
    .from("standard_risk_library")
    .select("*")
    .ilike("process_name", `%${processName}%`)
    .limit(limit);

  // Optional status column — ignore filter errors
  const { data, error } = await q;
  if (error) {
    console.warn("[aiCache] library fetch failed", error.message);
    return [];
  }
  return libraryRowsToRiskItems(data || [], processName);
}

export async function fetchApprovedAccidentCases(
  adminClient: any,
  processName: string,
  limit = 4,
): Promise<any[]> {
  if (!processName) return [];
  // Reuse prior assessment_accidents as approved corpus when process matches
  const { data, error } = await adminClient
    .from("assessment_accidents")
    .select("title, occurrence_date, location, accident_summary, cause, result, prevention, process")
    .ilike("process", `%${processName}%`)
    .order("created_at", { ascending: false })
    .limit(limit * 3);
  if (error) {
    console.warn("[aiCache] accident library fetch failed", error.message);
    return [];
  }
  const cases = (data || [])
    .map((c: any) => ({
      title: c.title || "중대재해 사례",
      occurrence_date: c.occurrence_date || "",
      location: c.location || "국내 건설현장",
      accident_summary: c.accident_summary || "",
      cause: c.cause || "",
      result: c.result || "",
      prevention: c.prevention || "",
      source: "library",
    }))
    .filter((c: any) => c.title || c.accident_summary || c.cause)
    .slice(0, limit);
  return cases;
}
