/**
 * Create / link 1 TBM session per work permit (pull fields + optional AI draft).
 */
import { supabase } from "@/integrations/supabase/client";
import { PERMIT_KIND_LABEL, normalizePermitKinds, type PermitKindId } from "@/lib/permitKinds";

export type TbmFromPermitResult =
  | { ok: true; tbmId: string; reused: boolean }
  | { ok: false; error: string };

const PRECHECK_DEFAULT = [
  "보호구(안전모·안전화·안전대 등) 착용 확인",
  "건강이상·음주 여부 확인",
  "장비·공구 상태 확인",
  "작업장 정리정돈·출입로 확보",
].join("\n");

export function buildTbmSeedFromPermit(permit: any, projectName?: string) {
  const fd = permit.form_data || {};
  const kinds = normalizePermitKinds(
    permit.permit_kinds,
    (permit.permit_type || "general") as PermitKindId,
  );
  const kindLabel = kinds.map((k) => PERMIT_KIND_LABEL[k] || k).join(", ");
  const workName = fd.work_name || permit.work_name || permit.work_description || "작업";
  const workDesc = fd.work_description || permit.work_description || "";
  const location = fd.work_location || permit.location || "";
  const company = fd.contractor_company || permit.contractor_company || "";

  const kindHints: string[] = [];
  if (kinds.includes("confined_space")) kindHints.push("밀폐공간: 출입 전 가스측정·감시인 배치");
  if (kinds.includes("hot_work")) kindHints.push("화기작업: 소화기·불티비산 방지·화기감시");
  if (kinds.includes("excavation")) kindHints.push("굴착: 사면·매설물·접근통제 확인");

  const prohibited =
    [kindHints.join("\n"), "무단 작업 금지", "보호구 미착용 작업 금지"].filter(Boolean).join("\n");

  return {
    title: `[허가서] ${workName}`,
    tbm_date: permit.permit_date,
    location,
    company_name: company,
    work_content: workDesc || workName,
    work_steps: kindLabel ? `허가종류: ${kindLabel}` : "",
    special_notes: PRECHECK_DEFAULT,
    prohibited_actions: prohibited,
    briefing_summary: "", // filled by AI or template
    briefing_risks: [] as { hazard: string; grade: string; measure: string }[],
    projectName: projectName || "",
  };
}

/** Non-AI fallback briefing text. */
export function templateBriefingSummary(seed: ReturnType<typeof buildTbmSeedFromPermit>): string {
  return [
    `【금일 작업】 ${seed.work_content}`,
    seed.location ? `【장소】 ${seed.location}` : "",
    seed.work_steps ? `【구분】 ${seed.work_steps}` : "",
    "",
    "【중점 안전】",
    "- 작업 전 보호구·장비·건강상태를 확인합니다.",
    "- 위험구간 출입 시 관리자 지시에 따릅니다.",
    "- 이상 발견 시 즉시 작업을 중지하고 보고합니다.",
    seed.prohibited_actions ? `\n【금지·주의】\n${seed.prohibited_actions}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * AI draft for briefing_summary only (uses education material when run linked;
 * otherwise template).
 */
export async function draftTbmBriefingAi(opts: {
  projectId: string;
  permit: any;
  seed: ReturnType<typeof buildTbmSeedFromPermit>;
}): Promise<string> {
  const runId = opts.permit.assessment_run_id || null;
  try {
    if (runId) {
      const { data, error } = await supabase.functions.invoke("generate-education-material", {
        body: { run_id: runId, project_id: opts.projectId },
      });
      if (!error && data?.tbm_summary) return String(data.tbm_summary);
      if (!error && data?.material?.tbm_summary) return String(data.material.tbm_summary);
    }
  } catch {
    /* fall through */
  }
  return templateBriefingSummary(opts.seed);
}

/**
 * TBM 주관자 = 허가서 작성자.
 * 우선순위: 신청자명 → 상신자명 → (비동기) created_by 프로필 → fallback.
 */
export function resolvePermitAuthorName(permit: any, fallback = ""): string {
  const fd = permit?.form_data || {};
  const fromForm = String(fd.applicant_name || fd.writer_name || fd.author_name || "").trim();
  if (fromForm) return fromForm;
  const submitted = String(permit?.submitted_by_name || "").trim();
  if (submitted) return submitted;
  return String(fallback || "").trim();
}

async function resolvePermitAuthorNameAsync(permit: any, fallback = ""): Promise<string> {
  const sync = resolvePermitAuthorName(permit, "");
  if (sync) return sync;
  const createdBy = permit?.created_by;
  if (createdBy) {
    const { data } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("user_id", createdBy)
      .maybeSingle();
    const name = String((data as any)?.display_name || "").trim();
    if (name) return name;
  }
  return String(fallback || "").trim();
}

/** Ensure 1:1 TBM for permit — reuse if work_permits.tbm_session_id set. */
export async function ensureTbmForPermit(opts: {
  permitId: string;
  projectId: string;
  /** Fallback only when permit author cannot be resolved */
  leaderName?: string;
  companyId?: string | null;
  useAiDraft?: boolean;
}): Promise<TbmFromPermitResult> {
  const { data: permit, error: perr } = await supabase
    .from("work_permits" as any)
    .select("*")
    .eq("id", opts.permitId)
    .maybeSingle();
  if (perr || !permit) return { ok: false, error: perr?.message || "허가서를 찾을 수 없습니다." };

  if ((permit as any).tbm_session_id) {
    return { ok: true, tbmId: (permit as any).tbm_session_id, reused: true };
  }

  const seed = buildTbmSeedFromPermit(permit);
  const leaderName = await resolvePermitAuthorNameAsync(permit, opts.leaderName || "");
  let summary = templateBriefingSummary(seed);
  if (opts.useAiDraft !== false) {
    summary = await draftTbmBriefingAi({
      projectId: opts.projectId,
      permit,
      seed,
    });
  }

  // Pull a few risk rows if assessment linked
  let risks: { hazard: string; grade: string; measure: string }[] = [];
  const runId = (permit as any).assessment_run_id;
  if (runId) {
    const { data: items } = await supabase
      .from("risk_items")
      .select("hazard, improvement_measure, risk_grade")
      .eq("run_id", runId)
      .order("risk_grade", { ascending: false })
      .limit(8);
    risks = ((items as any[]) || []).map((r) => ({
      hazard: r.hazard || "",
      grade: String(r.risk_grade ?? ""),
      measure: r.improvement_measure || "",
    }));
  }

  const insertPayload: any = {
    project_id: opts.projectId,
    run_id: runId || null,
    title: seed.title,
    tbm_date: seed.tbm_date,
    location: seed.location,
    leader_name: leaderName,
    company_id: opts.companyId || (permit as any).company_id || null,
    company_name: seed.company_name,
    work_content: seed.work_content,
    work_steps: seed.work_steps,
    special_notes: seed.special_notes,
    prohibited_actions: seed.prohibited_actions,
    briefing_summary: summary,
    briefing_risks: risks,
    is_active: true,
  };

  const { data: created, error: cerr } = await supabase
    .from("tbm_sessions" as any)
    .insert(insertPayload)
    .select("id")
    .single();
  if (cerr || !created) return { ok: false, error: cerr?.message || "TBM 생성 실패" };

  const tbmId = (created as any).id;

  // Link via RPC so approved/in-approval permits are not blocked by edit lock
  const { data: linkedId, error: linkErr } = await supabase.rpc("link_work_permit_tbm", {
    _permit_id: opts.permitId,
    _tbm_session_id: tbmId,
  });

  if (linkErr) {
    // Soft-delete orphan TBM when link fails (race / already linked / permission)
    await supabase
      .from("tbm_sessions" as any)
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_reason: "permit_link_failed",
      })
      .eq("id", tbmId);
    return { ok: false, error: linkErr.message };
  }

  return { ok: true, tbmId: (linkedId as string) || tbmId, reused: false };
}

export function canManagePermitCrew(role: string | null | undefined, isMaster?: boolean): boolean {
  if (isMaster) return true;
  const r = (role || "").toLowerCase();
  return [
    "master",
    "project_admin",
    "safety_manager",
    "site_manager",
    "supervisor",
    "site_supervisor",
  ].includes(r);
}
