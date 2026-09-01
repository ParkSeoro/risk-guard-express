import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

async function imageUrlToBase64(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) {
      console.error(`Image fetch failed: ${res.status} ${url}`);
      return null;
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 2.5 * 1024 * 1024) {
      console.warn(`Image too large for PDF embed (${buf.byteLength}): ${url}`);
      return null;
    }
    const ct = res.headers.get("content-type") || "image/jpeg";
    const bytes = new Uint8Array(buf);
    let binary = "";
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
    }
    const b64 = btoa(binary);
    return `data:${ct};base64,${b64}`;
  } catch (err) {
    console.error(`Image conversion error: ${err} ${url}`);
    return null;
  }
}

function formatKST(d: string | null | undefined): string {
  if (!d) return "";
  const dt = new Date(d);
  const kst = new Date(dt.getTime() + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kst.getUTCDate()).padStart(2, '0');
  const h = String(kst.getUTCHours()).padStart(2, '0');
  const min = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${day} ${h}:${min}`;
}

/** Keep in sync with src/lib/weeklyAssessmentLink.ts */
function normalizeCompanyIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function companyTargetsOverlap(a: unknown, b: unknown): boolean {
  const na = normalizeCompanyIds(a);
  const nb = normalizeCompanyIds(b);
  if (na.length === 0 && nb.length === 0) return true;
  if (na.length === 0 || nb.length === 0) return false;
  const other = new Set(nb);
  return na.some((id) => other.has(id));
}

function periodKey(run: any): string | null {
  const start = String(run?.start_date || "").trim();
  if (start) return start.slice(0, 10);
  const created = String(run?.created_at || "").trim();
  return created ? created.slice(0, 10) : null;
}

function pickPreviousApprovedRun(current: any, candidates: any[]): any | null {
  const eligible = (candidates || []).filter((c) => {
    if (!c?.id || c.id === current.id) return false;
    if (c.project_id !== current.project_id) return false;
    if (c.status !== "승인완료") return false;
    if (c.is_deleted) return false;
    return companyTargetsOverlap(current.target_company_ids, c.target_company_ids);
  });
  if (eligible.length === 0) return null;
  const sameType = current.type ? eligible.filter((c) => c.type === current.type) : [];
  const pool = sameType.length > 0 ? sameType : eligible;
  const currentStart = String(current.start_date || "").trim().slice(0, 10);
  const beforeByStart = currentStart
    ? pool.filter((c) => {
        const key = periodKey(c);
        return !!key && key < currentStart;
      })
    : [];
  const beforeByCreated = pool.filter((c) => c.created_at < current.created_at);
  const ranked = (beforeByStart.length > 0
    ? beforeByStart
    : beforeByCreated.length > 0
      ? beforeByCreated
      : []).slice();
  if (ranked.length === 0) return null;
  ranked.sort((a: any, b: any) => {
    const ak = periodKey(a) || a.created_at;
    const bk = periodKey(b) || b.created_at;
    if (ak !== bk) return ak < bk ? 1 : -1;
    return a.created_at < b.created_at ? 1 : -1;
  });
  return ranked[0] || null;
}

function resolvePrintFeedbackRun(current: any, previous: any | null): any | null {
  if (previous) return previous;
  if (current?.status === "승인완료") return current;
  return null;
}

const JOB_TITLE_LABELS: Record<string, string> = {
  contractor_supervisor: "관리감독자",
  contractor_pic: "관리감독자",
  contractor_safety_manager: "안전관리자",
  safety_pic: "안전관리자",
  contractor_site_director: "현장소장",
  site_director: "현장소장",
  owner_cm: "발주처 CM",
  owner_sm: "발주처 SM",
  cm: "발주처 CM",
  sm: "발주처 SM",
  gc: "시공사",
  gc_manager: "시공사 관리자",
  gc_pm: "시공사 PM",
  cooperator: "협조부서",
  SITE_SUPERVISOR: "관리감독자",
  site_supervisor: "관리감독자",
  SITE_MANAGER: "현장소장",
  site_manager: "현장소장",
  HSE_MANAGER: "안전관리자",
  safety_manager: "안전관리자",
  SUPERVISOR: "감리",
  supervisor: "감리",
  OWNER_SM: "발주처 SM",
  OWNER_CM: "발주처 CM",
  OWNER_PM: "발주처 PM",
  OWNER_HSE: "발주처 SM",
  project_admin: "프로젝트 관리자",
};

const POSITION_RANK: Record<string, number> = {
  contractor_supervisor: 10,
  contractor_safety_manager: 11,
  contractor_site_director: 12,
  gc: 20,
  gc_manager: 21,
  gc_pm: 22,
  owner_cm: 30,
  owner_sm: 31,
  cooperator: 40,
};

function positionRank(pos?: string | null): number {
  return POSITION_RANK[(pos || "").toLowerCase()] ?? 99;
}

function normalizeCoType(t?: string | null): string {
  const s = String(t || "").toLowerCase().trim();
  if (s === "client" || s === "발주처" || s === "owner") return "client";
  if (s === "gc" || s === "시공사" || s === "원도급" || s === "원청" || s === "general_contractor") return "gc";
  if (s === "contractor" || s === "협력사" || s === "하청" || s === "subcontractor") return "contractor";
  if (s === "vendor" || s === "공급사" || s === "납품사") return "vendor";
  return s;
}

function pickMemberRow(rows: any[], preferredCompanyId?: string | null): any | null {
  const list = (rows || []).filter(Boolean);
  if (list.length === 0) return null;
  const preferred = String(preferredCompanyId || "").trim();
  if (preferred) {
    const hit = list.find((r) => String(r.company_id || "") === preferred);
    if (hit) return hit;
  }
  const rank: Record<string, number> = {
    master: 100, project_admin: 90, safety_manager: 80, site_manager: 70,
    site_supervisor: 60, supervisor: 50, worker: 20, contractor: 20, viewer: 10,
  };
  const sorted = [...list].sort((a, b) => {
    const ra = rank[String(a.role_new || a.role || "").toLowerCase()] ?? 0;
    const rb = rank[String(b.role_new || b.role || "").toLowerCase()] ?? 0;
    if (rb !== ra) return rb - ra;
    return (b.company_id ? 1 : 0) - (a.company_id ? 1 : 0);
  });
  return sorted[0] ?? null;
}

function resolveParentGcId(
  authorCompanyId: string | null,
  companies: Array<{ id: string; type?: string | null; parent_company_id?: string | null }>,
): string | null {
  const byId = new Map(companies.map((c) => [c.id, c]));
  const author = authorCompanyId ? byId.get(authorCompanyId) : undefined;
  if (author && normalizeCoType(author.type) === "gc") return author.id;
  const walk = (startId: string | null | undefined): string | null => {
    let cur = startId || null;
    const seen = new Set<string>();
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const node = byId.get(cur);
      if (!node) break;
      if (normalizeCoType(node.type) === "gc") return node.id;
      cur = node.parent_company_id || null;
    }
    return null;
  };
  const fromParent = walk(author?.parent_company_id);
  if (fromParent) return fromParent;
  const gcs = companies.filter((c) => normalizeCoType(c.type) === "gc");
  if (gcs.length === 1) return gcs[0].id;
  return null;
}

function mapProjectCompanies(links: any[]): Array<{ id: string; name: string; type: string | null; parent_company_id: string | null }> {
  return (links || [])
    .map((l: any) => {
      const c = l.companies;
      if (!c || c.is_deleted === true) return null;
      return {
        id: c.id as string,
        name: c.name as string,
        type: c.type || l.role_in_project || null,
        parent_company_id: l.parent_company_id ?? c.parent_company_id ?? null,
      };
    })
    .filter(Boolean) as Array<{ id: string; name: string; type: string | null; parent_company_id: string | null }>;
}

function jobTitleLabel(pos?: string | null): string {
  const key = String(pos || "").trim();
  if (!key) return "";
  return JOB_TITLE_LABELS[key] || JOB_TITLE_LABELS[key.toLowerCase()] || JOB_TITLE_LABELS[key.toUpperCase()] || key;
}

function localizePersonName(name?: string | null): string {
  const raw = String(name || "").trim();
  return raw.replace(/\s*\/\s*([A-Za-z0-9_]+)\s*$/, (_m, code: string) => {
    const label = jobTitleLabel(code);
    return label ? ` / ${label}` : ` / ${code}`;
  });
}

function htmlEsc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function jwtSub(token: string): string | null {
  try {
    const seg = token.split(".")[1];
    if (!seg) return null;
    const pad = "=".repeat((4 - (seg.length % 4)) % 4);
    const json = atob(seg.replace(/-/g, "+").replace(/_/g, "/") + pad);
    const sub = JSON.parse(json)?.sub;
    return typeof sub === "string" && sub ? sub : null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "").trim() || "";
    // Gateway already verified JWT (verify_jwt). Do not call getUser/getClaims —
    // those hit Auth/JWKS and can stall the worker (546/503), hanging desktop CORS.
    if (!jwtSub(token)) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { runId, type, previousRunId } = await req.json();
    if (!runId) {
      return new Response(JSON.stringify({ error: "runId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: run, error: runError } = await userClient
      .from("assessment_runs").select("*").eq("id", runId).single();
    if (runError || !run) {
      return new Response(JSON.stringify({ error: "Not found or access denied" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: prevCandidates } = await supabase
      .from("assessment_runs")
      .select("id, project_id, type, status, start_date, end_date, created_at, target_company_ids, period_label, is_deleted")
      .eq("project_id", run.project_id)
      .eq("status", "승인완료")
      .eq("is_deleted", false)
      .neq("id", runId)
      .order("created_at", { ascending: false })
      .limit(80);

    let previousRun = pickPreviousApprovedRun(run, prevCandidates || []);
    if (previousRunId && previousRunId !== runId) {
      const hinted = (prevCandidates || []).find((c: any) => c.id === previousRunId)
        || (previousRun?.id === previousRunId ? previousRun : null);
      if (hinted && hinted.project_id === run.project_id) {
        previousRun = hinted;
      } else {
        const { data: hintedRow } = await supabase
          .from("assessment_runs")
          .select("id, project_id, type, status, start_date, end_date, created_at, target_company_ids, period_label, is_deleted")
          .eq("id", previousRunId)
          .maybeSingle();
        if (hintedRow && hintedRow.project_id === run.project_id && hintedRow.status === "승인완료" && !hintedRow.is_deleted) {
          previousRun = hintedRow;
        }
      }
    }
    const printFeedbackRun = resolvePrintFeedbackRun(run, previousRun);
    const printFeedbackRunId = printFeedbackRun?.id || runId;

    const [projectRes, itemsRes, participantsRes, feedbackRes, validationRes, approvalsRes, companyLinksRes, printFbItemsRes, opinionsRes, accidentsRes, healthRes] = await Promise.all([
      supabase.from("projects").select("*").eq("id", run.project_id).single(),
      supabase.from("risk_items").select("*").eq("run_id", runId).eq("is_deleted", false).order("sort_order"),
      supabase.from("assessment_run_participants").select("*").eq("run_id", runId),
      supabase.from("risk_item_feedback").select("*").eq("assessment_run_id", printFeedbackRunId),
      type === "validation"
        ? supabase.from("validation_results").select("*").eq("run_id", runId)
        : Promise.resolve({ data: [] }),
      supabase.from("approvals").select("*").eq("run_id", runId).order("approval_version", { ascending: false }),
      supabase.from("project_companies")
        .select("company_id, parent_company_id, role_in_project, companies:company_id(id, name, type, parent_company_id, is_deleted)")
        .eq("project_id", run.project_id)
        .eq("is_deleted", false),
      printFeedbackRunId !== runId
        ? supabase.from("risk_items").select("*").eq("run_id", printFeedbackRunId).eq("is_deleted", false)
        : Promise.resolve({ data: null }),
      supabase.from("worker_opinions").select("*").eq("run_id", runId).order("created_at"),
      supabase.from("assessment_accidents").select("*").eq("run_id", runId).order("created_at"),
      supabase.from("health_hazards").select("*").eq("run_id", runId).order("created_at"),
    ]);

    const project = projectRes.data;
    const items = ((itemsRes.data || []) as any[]).filter(
      (i: any) => !i?.is_deleted && !i?.is_excluded,
    );
    const participants = participantsRes.data || [];
    const feedbackItems = feedbackRes.data || [];
    const feedbackLabelItems = printFeedbackRunId !== runId
      ? (printFbItemsRes.data || [])
      : items;
    const validationResults = (validationRes as any).data || [];
    const approvals = approvalsRes.data || [];
    const workerOpinions = (opinionsRes.data || []) as any[];
    const assessmentAccidents = (accidentsRes.data || []) as any[];
    const healthHazards = (healthRes.data || []) as any[];
    let projectCompanies = mapProjectCompanies(companyLinksRes.data || []);
    if (projectCompanies.length === 0) {
      const { data: legacyCos, error: legacyErr } = await supabase
        .from("companies")
        .select("id, name, type, parent_company_id")
        .eq("project_id", run.project_id)
        .eq("is_deleted", false);
      if (legacyErr) {
        console.warn("legacy companies fallback failed", legacyErr.message);
      } else {
        projectCompanies = (legacyCos || []).map((c: any) => ({
          id: c.id, name: c.name, type: c.type, parent_company_id: c.parent_company_id || null,
        }));
      }
    }

    const clientCompanyName = projectCompanies.find((c) => normalizeCoType(c.type) === "client")?.name || "(미지정)";

    let authorCompanyName = "(미지정)";
    let gcCompanyNames = "(미지정)";
    let legalAuthorName = "";
    const legalAuthorId = run.author_user_id || run.created_by;
    if (legalAuthorId) {
      const { data: pmRows } = await supabase
        .from("project_members")
        .select("company_id, role_new, companies:company_id(name, type)")
        .eq("user_id", legalAuthorId)
        .eq("project_id", run.project_id);
      const pm = pickMemberRow(pmRows || []);
      const co = (pm as any)?.companies;
      const authorCompanyId = (pm as any)?.company_id || null;
      authorCompanyName = String(co?.name || "").trim() || "(미지정)";
      const gcId = resolveParentGcId(authorCompanyId, projectCompanies);
      gcCompanyNames = String(projectCompanies.find((c) => c.id === gcId)?.name || "").trim() || "(미지정)";
    }
    if (run.author_user_id) {
      const { data: authorProf } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", run.author_user_id)
        .maybeSingle();
      legalAuthorName = String(authorProf?.display_name || "").trim();
    }



    // ===== SIGNATURE: 결재선 SSOT (상신 후 approvals, 상신 전 document_approval_drafts) =====
    const latestVersion = approvals.length > 0 ? approvals[0].approval_version || 1 : 0;
    const latestApprovals = approvals
      .filter((a: any) => (a.approval_version || 1) === latestVersion && a.status !== "취소")
      .sort((a: any, b: any) => {
        const so = (a.step_order ?? 99) - (b.step_order ?? 99);
        if (so !== 0) return so;
        return positionRank(a.position) - positionRank(b.position);
      });

    let draftSteps: any[] = [];
    const { data: draftRow, error: draftErr } = await supabase
      .from("document_approval_drafts")
      .select("steps, status")
      .eq("entity_type", "assessment_run")
      .eq("entity_id", runId)
      .maybeSingle();
    if (draftErr) {
      console.warn("document_approval_drafts unavailable:", draftErr.message);
    } else if (Array.isArray((draftRow as any)?.steps)) {
      draftSteps = (draftRow as any).steps;
    }

    // Resolve company names for each approval step
    async function resolveCompanyName(userId: string, projectId: string): Promise<string> {
      const { data: members } = await supabase
        .from("project_members")
        .select("company_id, company, role_new, role")
        .eq("user_id", userId)
        .eq("project_id", projectId);
      const member = pickMemberRow(members || []);
      if (member?.company_id) {
        const { data: comp } = await supabase.from("companies").select("name").eq("id", member.company_id).maybeSingle();
        if (comp?.name) return comp.name;
      }
      if (member?.company) return member.company;
      const { data: prof } = await supabase.from("profiles").select("company").eq("user_id", userId).maybeSingle();
      return prof?.company || "";
    }

    const sigRows: string[] = [];
    if (latestApprovals.length > 0) {
      for (const ap of latestApprovals) {
        let companyName = ap.company_name || "";
        if (!companyName && ap.approver_id) {
          try {
            companyName = await resolveCompanyName(ap.approver_id, run.project_id);
          } catch (e) {
            console.warn("resolveCompanyName failed", e);
          }
        }
        const dateStr = ap.status === "승인" && ap.approved_at ? formatKST(ap.approved_at) : (ap.status === "반려" ? "반려" : "대기");
        sigRows.push(`<tr>
          <td class="sig-role">${ap.step || ""}</td>
          <td>${localizePersonName(ap.approver_name)}</td>
          <td>${companyName}</td>
          <td>${jobTitleLabel(ap.position)}</td>
          <td class="sig-stamp">${dateStr}</td>
        </tr>`);
      }
    } else if (draftSteps.length > 0) {
      for (const s of draftSteps) {
        sigRows.push(`<tr>
          <td class="sig-role">${s.label || s.step_label || ""}</td>
          <td>${localizePersonName(s.user_name)}</td>
          <td>${s.company_name || ""}</td>
          <td>${jobTitleLabel(s.position)}</td>
          <td class="sig-stamp"></td>
        </tr>`);
      }
    } else {
      sigRows.push(`<tr><td colspan="5" class="center" style="color:#64748b">저장된 결재선이 없습니다. 상신 전 결재선을 저장하세요.</td></tr>`);
    }

    const sigRowsHtml = sigRows.join("");

    // ===== FEEDBACK IMAGES: No slicing, show ALL before AND after =====
    const feedbackWithImages = await Promise.all(
      feedbackItems.map(async (fb: any) => {
        const beforeImages: string[] = [];
        const afterImages: string[] = [];
        // No .slice() — process ALL images
        for (const url of (fb.before_image_urls || [])) {
          try {
            const b64 = await imageUrlToBase64(url);
            beforeImages.push(b64 || url);
          } catch {
            beforeImages.push(url);
          }
        }
        for (const url of (fb.after_image_urls || [])) {
          try {
            const b64 = await imageUrlToBase64(url);
            afterImages.push(b64 || url);
          } catch {
            afterImages.push(url);
          }
        }
        return { ...fb, beforeBase64: beforeImages, afterBase64: afterImages };
      })
    );

    // ===== WORKER IMAGES: No slicing — process ALL =====
    const workerImages: string[] = [];
    for (const url of (run.worker_participation_images || [])) {
      try {
        const b64 = await imageUrlToBase64(url);
        workerImages.push(b64 || url);
      } catch {
        workerImages.push(url);
      }
    }

    const gradeColor = (g: string) =>
      g === "상" ? "#dc2626" : g === "중" ? "#d97706" : "#16a34a";
    const gradeBg = (g: string) =>
      g === "상" ? "#fecaca" : g === "중" ? "#fef08a" : "#bbf7d0";

    const today = formatKST(new Date().toISOString()).slice(0, 10);
    const runPeriod = run.start_date && run.end_date
      ? `${run.start_date} ~ ${run.end_date}`
      : `${project?.period_start || ""} ~ ${project?.period_end || ""}`;

    const highCount = items.filter((i: any) => i.risk_grade === "상").length;
    const medCount = items.filter((i: any) => i.risk_grade === "중").length;
    const lowCount = items.filter((i: any) => i.risk_grade === "하").length;

    // Risk items table
    const itemRows = items.map((item: any, i: number) => `
      <tr>
        <td class="center">${i + 1}</td>
        <td>${item.process || ""}</td>
        <td>${item.sub_task || ""}</td>
        <td>${item.hazard || ""}</td>
        <td>${item.hazard_situation || ""}</td>
        <td>${item.existing_measure || ""}</td>
        <td>${item.improvement_measure || ""}</td>
        <td class="center grade" style="background:${gradeBg(item.likelihood_grade)};color:${gradeColor(item.likelihood_grade)}">${item.likelihood_grade || "중"}</td>
        <td class="center grade" style="background:${gradeBg(item.severity_grade)};color:${gradeColor(item.severity_grade)}">${item.severity_grade || "중"}</td>
        <td class="center grade" style="background:${gradeBg(item.risk_grade)};color:${gradeColor(item.risk_grade)};font-weight:bold">${item.risk_grade || "중"}</td>
        <td class="center grade" style="background:${gradeBg(item.improved_likelihood_grade)};color:${gradeColor(item.improved_likelihood_grade)}">${item.improved_likelihood_grade || "하"}</td>
        <td class="center grade" style="background:${gradeBg(item.improved_severity_grade)};color:${gradeColor(item.improved_severity_grade)}">${item.improved_severity_grade || "하"}</td>
        <td class="center grade" style="background:${gradeBg(item.improved_risk_grade)};color:${gradeColor(item.improved_risk_grade)};font-weight:bold">${item.improved_risk_grade || "하"}</td>
        <td class="center">${item.status || ""}</td>
        <td>${(item.ppe || []).join(", ")}</td>
        <td style="font-size:7pt;">${(item.legal_basis || []).join(", ")}</td>
        <td>${item.department || ""}</td>
        <td>${item.assignee || ""}</td>
      </tr>`).join("");

    // Feedback section with ALL photos (before AND after)
    let feedbackSection = "";
    if (feedbackWithImages.length > 0) {
      const fbRows = feedbackWithImages.map((fb: any, idx: number) => {
        const item = feedbackLabelItems.find((i: any) => i.id === fb.risk_item_id);
        const itemLabel = item ? `${item.process} – ${item.sub_task || ""}` : "(전체)";
        const statusColor = fb.status === "완료" ? "#16a34a" : fb.status === "진행중" ? "#d97706" : "#dc2626";

        let imagesHtml = "";
        if (fb.beforeBase64.length > 0 || fb.afterBase64.length > 0) {
          const allPhotos: { label: string; src: string }[] = [];
          fb.beforeBase64.forEach((b64: string) => allPhotos.push({ label: "조치 전", src: b64 }));
          fb.afterBase64.forEach((b64: string) => allPhotos.push({ label: "조치 후", src: b64 }));

          const photoGrid = allPhotos.map((p) =>
            `<div style="width:48%;page-break-inside:avoid;margin-bottom:4pt;">
              <div style="font-size:6pt;font-weight:600;color:#475569;margin-bottom:2pt;">▸ ${p.label}</div>
              <img src="${p.src}" style="width:100%;max-height:140pt;object-fit:contain;border:1px solid #cbd5e1;border-radius:3pt;" />
            </div>`
          ).join("");

          imagesHtml = `<tr><td colspan="5" style="padding:4pt;page-break-inside:avoid;">
            <div style="display:flex;flex-wrap:wrap;gap:4pt;justify-content:flex-start;">
              ${photoGrid}
            </div>
          </td></tr>`;
        }

        return `<tr style="page-break-inside:avoid;">
            <td class="center">${idx + 1}</td>
            <td>${itemLabel}</td>
            <td>${fb.description || ""}</td>
            <td class="center" style="color:${statusColor};font-weight:600;">${fb.status}</td>
            <td class="center">${fb.completed_at ? formatKST(fb.completed_at) : "-"}</td>
          </tr>${imagesHtml}`;
      }).join("");

      const prevLabel = printFeedbackRun && printFeedbackRun.id !== runId
        ? ` (전회차 ${printFeedbackRun.period_label || ""})`
        : "";
      feedbackSection = `
        <div class="page-break"></div>
        <div class="section-header">금주 이행 확인${prevLabel}</div>
        <div class="summary-text">전회차 실행 작업의 조치 전후 사진 · 총 ${feedbackWithImages.length}건 · 완료 ${feedbackWithImages.filter((f: any) => f.status === "완료").length}건 · 미조치 ${feedbackWithImages.filter((f: any) => f.status === "미조치").length}건</div>
        <table>
          <thead><tr><th>No</th><th>관련 항목</th><th>조치 내용</th><th>상태</th><th>완료일</th></tr></thead>
          <tbody>${fbRows}</tbody>
        </table>`;
    }

    // Validation section
    let validationSection = "";
    if (type === "validation" && validationResults.length > 0) {
      const vRows = validationResults.map((vr: any, i: number) =>
        `<tr><td class="center">${i + 1}</td><td>${vr.status}</td><td>${vr.message || ""}</td></tr>`
      ).join("");
      validationSection = `
        <div class="page-break"></div>
        <div class="section-header">검증 결과 리포트</div>
        <div class="summary-text">검증 점수: ${run.validation_score ?? "-"} / 판정: ${run.validation_verdict ?? "-"}</div>
        <table><thead><tr><th>#</th><th>상태</th><th>메시지</th></tr></thead><tbody>${vRows}</tbody></table>`;
    }

    // Managed risk items section
    const managedItems = items.filter((i: any) => i.improved_risk_grade === "상" && i.improvement_measure && i.improvement_measure.trim().length > 0);
    let managedSection = "";
    if (managedItems.length > 0) {
      const managedRows = managedItems.map((item: any, idx: number) => `
        <tr>
          <td class="center">${idx + 1}</td>
          <td>${item.process || ""}</td>
          <td>${item.sub_task || ""}</td>
          <td>${item.hazard || ""}</td>
          <td>${item.improvement_measure || ""}</td>
          <td class="center grade" style="background:${gradeBg("상")};color:${gradeColor("상")};font-weight:bold">상</td>
          <td>${item.department || ""}</td>
          <td>${item.assignee || ""}</td>
        </tr>`).join("");
      managedSection = `
        <div class="page-break"></div>
        <div class="section-header">차주 고위험 관리대상 (조치 사진 없음)</div>
        <div class="summary-text">이번 회차에서 개선 후에도 위험도 '상'인 항목 (${managedItems.length}건). 조치 전후 사진은 금주 이행 확인(전회차) 섹션에만 있습니다.</div>
        <table class="risk-grid">
          <thead><tr><th>No</th><th>공정</th><th>세부작업</th><th>위험요인</th><th>개선대책</th><th>위험도</th><th>부서</th><th>담당</th></tr></thead>
          <tbody>${managedRows}</tbody>
        </table>`;
    }

    // Worker participation images — ALL images, 2-column layout
    let workerImageSection = "";
    if (workerImages.length > 0) {
      const wpGrid = workerImages.map((b64: string, idx: number) =>
        `<div style="width:48%;page-break-inside:avoid;margin-bottom:6pt;">
          <div style="font-size:7pt;color:#475569;margin-bottom:2pt;">사진 ${idx + 1}</div>
          <img src="${b64}" style="width:100%;max-height:200pt;object-fit:contain;border:1px solid #cbd5e1;border-radius:3pt;" />
        </div>`
      ).join("");
      workerImageSection = `
        <div class="section-header" style="margin-top:10pt;">근로자 참여 사진</div>
        <div style="display:flex;flex-wrap:wrap;gap:8pt;padding:4pt 0;">
          ${wpGrid}
        </div>`;
    }

    const opinionRows = workerOpinions.map((o: any, i: number) => {
      const who = [o.worker_name, o.worker_company, o.worker_position].filter(Boolean).join(" · ");
      const sig = o.signature_url
        ? `<img src="${htmlEsc(o.signature_url)}" alt="서명" style="height:22pt;max-width:80pt;object-fit:contain;" />`
        : "";
      return `<tr>
        <td class="center">${i + 1}</td>
        <td>${htmlEsc(who)}</td>
        <td>${htmlEsc(o.opinion_text)}</td>
        <td class="center">${sig}</td>
      </tr>`;
    }).join("");
    const opinionSection = `
      <div class="section-header">근로자 의견</div>
      <table>
        <thead><tr><th style="width:5%">No</th><th style="width:22%">참여자</th><th>의견</th><th style="width:14%">서명</th></tr></thead>
        <tbody>${opinionRows || '<tr><td colspan="4" class="center">등록된 근로자 의견이 없습니다</td></tr>'}</tbody>
      </table>`;

    const accidentRows = assessmentAccidents.map((a: any, i: number) => `<tr>
      <td class="center">${i + 1}</td>
      <td>${htmlEsc(a.occurrence_date || "일자 미상")}<br/>${htmlEsc(a.location || "장소 미상")}</td>
      <td>${htmlEsc(a.accident_type || "")}${a.process ? `<br/><span style="color:#64748b">${htmlEsc(a.process)}</span>` : ""}</td>
      <td>${htmlEsc(a.accident_summary || a.description || "")}</td>
      <td>${htmlEsc(a.cause || "")}</td>
      <td>${htmlEsc(a.result || "")}</td>
      <td>${htmlEsc(a.prevention || "")}</td>
    </tr>`).join("");
    const accidentSection = `
      <div class="section-header">사고사례</div>
      <table>
        <thead><tr>
          <th style="width:4%">No</th><th style="width:12%">발생</th><th style="width:10%">유형</th>
          <th>개요</th><th style="width:14%">원인</th><th style="width:12%">결과</th><th style="width:16%">예방대책</th>
        </tr></thead>
        <tbody>${accidentRows || '<tr><td colspan="7" class="center">등록된 사고사례가 없습니다</td></tr>'}</tbody>
      </table>`;

    const healthRows = healthHazards.map((h: any, i: number) => `<tr>
      <td class="center">${i + 1}</td>
      <td>${htmlEsc(h.category || "")}</td>
      <td>${htmlEsc(h.process || "")}</td>
      <td>${htmlEsc(h.description || "")}</td>
      <td class="center">${htmlEsc(h.exposure_level || "")}</td>
      <td>${htmlEsc(h.countermeasure || "")}</td>
      <td>${htmlEsc(h.legal_basis || "")}</td>
    </tr>`).join("");
    const healthSection = healthHazards.length > 0 ? `
      <div class="section-header">보건·유해요인</div>
      <table>
        <thead><tr>
          <th style="width:4%">No</th><th style="width:10%">분류</th><th style="width:12%">공정</th>
          <th>내용</th><th style="width:8%">노출</th><th style="width:18%">대책</th><th style="width:14%">법적근거</th>
        </tr></thead>
        <tbody>${healthRows}</tbody>
      </table>` : "";

    const docTitle = `위험성평가표 [${run.type}] ${run.period_label}`;
    const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<title>${docTitle.replace(/</g,'&lt;')}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@300;400;500;700&display=swap');
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: 'Noto Sans KR', 'Malgun Gothic', sans-serif; font-size: 9pt; color: #1e293b; line-height: 1.4; }
@page { size: A4 landscape; margin: 12mm 10mm; }
.page-break { page-break-before: always; }

.report-header {
  border: 2px solid #1e293b;
  margin-bottom: 10pt;
}
.report-title {
  background: #1e293b;
  color: white;
  text-align: center;
  padding: 8pt 0;
  font-size: 16pt;
  font-weight: 700;
  letter-spacing: 2pt;
}
.report-subtitle {
  text-align: center;
  padding: 4pt 0;
  font-size: 11pt;
  color: #475569;
  border-bottom: 1px solid #e2e8f0;
}
.report-info {
  display: table;
  width: 100%;
  border-collapse: collapse;
}
.report-info-row { display: table-row; }
.report-info-label {
  display: table-cell;
  background: #f1f5f9;
  font-weight: 600;
  font-size: 8pt;
  padding: 4pt 8pt;
  border: 1px solid #e2e8f0;
  width: 80pt;
  white-space: nowrap;
  color: #334155;
}
.report-info-value {
  display: table-cell;
  font-size: 8pt;
  padding: 4pt 8pt;
  border: 1px solid #e2e8f0;
  color: #1e293b;
}

.section-header {
  font-size: 11pt;
  font-weight: 700;
  margin: 10pt 0 4pt;
  padding: 4pt 8pt;
  background: #f1f5f9;
  border-left: 4pt solid #1e293b;
}
.summary-text {
  font-size: 8pt;
  color: #475569;
  margin-bottom: 6pt;
  padding-left: 4pt;
}

.table-container {
  width: 100%;
  overflow-x: visible;
}
/* fixed layout prevents landscape column squash / right-edge clipping */
table { width: 100%; border-collapse: collapse; font-size: 7pt; margin-bottom: 10pt; table-layout: fixed; }
th, td {
  border: 1px solid #cbd5e1;
  padding: 2pt 3pt;
  text-align: left;
  vertical-align: top;
  word-break: break-word;
  overflow-wrap: anywhere;
  overflow: hidden;
  hyphens: auto;
}
th { background: #1e293b; color: white; font-weight: 500; text-align: center; white-space: normal; font-size: 6.5pt; }
.center { text-align: center; }
.nowrap { white-space: normal; }
.grade { font-weight: 600; text-align: center; }
/* max-width:0 forces wrap inside table-layout:fixed so 공정 cannot paint over 세부작업 */
.risk-grid td, .risk-grid th {
  white-space: normal !important;
  overflow: hidden;
  max-width: 0;
  line-height: 1.25;
}

.sig-table { width: auto; margin-top: 8pt; table-layout: auto; }
.sig-table th { background: #475569; }
.sig-table td { min-width: 60pt; height: 24pt; }
.sig-role { background: #f8fafc; font-weight: 500; }
.sig-stamp { min-width: 80pt; }

thead { display: table-header-group; }
img { max-width: 100%; height: auto; display: inline-block; }
/* Allow tall rows to split across pages instead of clipping */
tr { page-break-inside: auto; }
td, th { page-break-inside: auto; }
@media print {
  body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table { page-break-inside: auto; }
}
</style>
</head>
<body>
  <!-- Report Header -->
  <div class="report-header">
    <div class="report-title">위험성평가표</div>
    <div class="report-subtitle">[${run.type}] ${run.period_label || ""}</div>
    <div class="report-info">
      <div class="report-info-row">
        <div class="report-info-label">프로젝트명</div>
        <div class="report-info-value">${project?.name || ""}</div>
        <div class="report-info-label">현장명</div>
        <div class="report-info-value">${project?.site_name || ""}</div>
      </div>
      <div class="report-info-row">
        <div class="report-info-label">발주처</div>
        <div class="report-info-value">${clientCompanyName}</div>
        <div class="report-info-label">시공사</div>
        <div class="report-info-value">${gcCompanyNames}</div>
      </div>
      <div class="report-info-row">
        <div class="report-info-label">작성 관리감독자</div>
        <div class="report-info-value">${legalAuthorName || "미지정"}</div>
        <div class="report-info-label">작성 회사</div>
        <div class="report-info-value">${authorCompanyName}</div>
      </div>
      <div class="report-info-row">
        <div class="report-info-label">적용기간</div>
        <div class="report-info-value">${runPeriod}</div>
        <div class="report-info-label">출력일</div>
        <div class="report-info-value">${today}</div>
      </div>
      <div class="report-info-row">
        <div class="report-info-label">항목수</div>
        <div class="report-info-value">${items.length}건 (상 ${highCount} / 중 ${medCount} / 하 ${lowCount})</div>
        <div class="report-info-label">검증결과</div>
        <div class="report-info-value">${run.validation_verdict || "-"} ${run.validation_score != null ? `(${run.validation_score}점)` : ""}</div>
      </div>
    </div>
  </div>

  <!-- Signature Section — from approval line (draft or submitted) -->
  <div class="section-header">서명란</div>
  <table class="sig-table">
    <thead><tr><th>구분</th><th>성명</th><th>소속</th><th>직책</th><th>서명 / 일자</th></tr></thead>
    <tbody>${sigRowsHtml}</tbody>
  </table>

  <!-- Risk Assessment Table -->
  <div class="section-header">위험성평가 항목</div>
  <div class="table-container">
  <table class="risk-grid">
    <thead>
      <tr>
        <th style="width:3%">No</th><th style="width:10%">공정</th><th style="width:10%">세부작업</th><th style="width:8%">위험요인</th><th style="width:8%">위험발생상황</th>
        <th style="width:8%">기존대책</th><th style="width:8%">개선대책</th>
        <th style="width:3%">가능성</th><th style="width:3%">중대성</th><th style="width:3%">위험도</th>
        <th style="width:3%">가능성'</th><th style="width:3%">중대성'</th><th style="width:3%">위험도'</th>
        <th style="width:4%">상태</th><th style="width:5%">PPE</th><th style="width:6%">법적근거</th><th style="width:4%">부서</th><th style="width:5%">담당</th>
      </tr>
    </thead>
    <tbody>
      ${itemRows || '<tr><td colspan="18" class="center">항목 없음</td></tr>'}
    </tbody>
  </table>
  </div>

  ${managedSection}

  ${feedbackSection}
  ${validationSection}

  ${opinionSection}
  ${accidentSection}
  ${healthSection}

  <!-- Worker Participation Signature Page (always separate page) -->
  <div class="page-break"></div>
  <div class="section-header" style="text-align:center;border-left:none;font-size:14pt;padding:8pt;">근로자 참여 및 공유 서명</div>
  <div class="summary-text" style="text-align:center;margin-bottom:10pt;">본 위험성평가 내용을 교육받고 숙지하였음을 확인합니다.</div>
  <table>
    <thead><tr><th style="width:5%">No</th><th style="width:15%">소속</th><th style="width:15%">성명</th><th style="width:20%">서명</th><th style="width:5%">No</th><th style="width:15%">소속</th><th style="width:15%">성명</th><th style="width:20%">서명</th></tr></thead>
    <tbody>
      ${Array.from({ length: 15 }, (_, i) => `
        <tr>
          <td class="center" style="height:28pt;">${i * 2 + 1}</td><td></td><td></td><td></td>
          <td class="center" style="height:28pt;">${i * 2 + 2}</td><td></td><td></td><td></td>
        </tr>`).join("")}
    </tbody>
  </table>

  ${workerImageSection}

  <div style="text-align:right;font-size:7pt;color:#94a3b8;margin-top:4pt;">출력일: ${today}</div>
</body>
</html>`;

    return new Response(JSON.stringify({
      html, title: docTitle,
      fileName: `위험성평가_${run.type}_${run.period_label}_${today}.pdf`
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("PDF generation error:", error);
    return new Response(
      JSON.stringify({ error: `PDF generation failed: ${error?.message || String(error)}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
