/**
 * 작업계획서 회차 복사.
 * 본문·작업기간·리깅·첨부를 함께 복사하고, 결재 상태와 서명은 새 작성중으로 둔다.
 * 리깅이나 첨부가 실패하면 방금 만든 문서를 지워 빈 회차를 남기지 않는다.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { buildRiggingPlanPayload, type RiggingPlanRow } from "@/lib/riggingPlanPersist";
import { cloneAttachmentFiles } from "@/lib/workPlanAttachments";

export type WorkPlanCloneSource = {
  id: string;
  project_id: string;
  company_id?: string | null;
  work_type: string;
  title?: string | null;
  version?: number | null;
  author_user_id?: string | null;
  sections?: unknown;
  start_date?: string | null;
  end_date?: string | null;
  assessment_run_id?: string | null;
  auto_education_enabled?: boolean | null;
};

export function workPlanCloneTitle(title: string | null | undefined, version: number | null | undefined): string {
  const base = (title || "작업계획서").trim() || "작업계획서";
  return `${base} (v${(version || 1) + 1})`;
}

/** Insert row for the new draft. Approval, void, and signatures stay off this object. */
export function buildWorkPlanCloneInsert(source: WorkPlanCloneSource, createdBy: string) {
  return {
    project_id: source.project_id,
    company_id: source.company_id ?? null,
    work_type: source.work_type,
    title: workPlanCloneTitle(source.title, source.version),
    sections: (source.sections ?? []) as Json,
    attachments: [] as Json,
    created_by: createdBy,
    author_user_id: source.author_user_id || null,
    parent_id: source.id,
    version: (source.version || 1) + 1,
    status: "작성중" as const,
    start_date: source.start_date || null,
    end_date: source.end_date || null,
    assessment_run_id: source.assessment_run_id || null,
    auto_education_enabled: source.auto_education_enabled ?? true,
  };
}

export type CloneWorkPlanResult =
  | { ok: true; id: string; version: number }
  | { ok: false; error: string };

const SOURCE_COLUMNS =
  "id, project_id, company_id, work_type, title, version, author_user_id, sections, start_date, end_date, assessment_run_id, auto_education_enabled";

async function discardClone(id: string): Promise<string | null> {
  const { error } = await supabase.from("work_plans").delete().eq("id", id);
  return error ? error.message : null;
}

export async function cloneWorkPlanDocument(opts: {
  fromPlanId: string;
  createdBy: string;
}): Promise<CloneWorkPlanResult> {
  const { data: source, error: sourceError } = await supabase
    .from("work_plans")
    .select(SOURCE_COLUMNS)
    .eq("id", opts.fromPlanId)
    .maybeSingle();
  if (sourceError) return { ok: false, error: sourceError.message };
  if (!source) return { ok: false, error: "원본 작업계획서를 찾지 못했습니다." };

  const row = buildWorkPlanCloneInsert(source as WorkPlanCloneSource, opts.createdBy);
  const { data: created, error: insertError } = await supabase
    .from("work_plans")
    .insert(row)
    .select("id, version")
    .single();
  if (insertError || !created) {
    return { ok: false, error: insertError?.message || "작업계획서를 만들지 못했습니다." };
  }

  const fail = async (message: string): Promise<CloneWorkPlanResult> => {
    const discardError = await discardClone(created.id);
    const extra = discardError ? ` 만든 문서를 지우지 못했습니다. ${discardError}` : "";
    return { ok: false, error: `${message}${extra}` };
  };

  try {
    await cloneAttachmentFiles({
      fromPlanId: source.id,
      toPlanId: created.id,
      projectId: source.project_id,
      companyId: source.company_id,
      workType: source.work_type,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "첨부를 복사하지 못했습니다.";
    return fail(message);
  }

  const { data: srcRig, error: rigError } = await supabase
    .from("rigging_plans")
    .select("*")
    .eq("work_plan_id", source.id)
    .maybeSingle();
  if (rigError) return fail(rigError.message);
  if (srcRig) {
    const payload = buildRiggingPlanPayload(created.id, srcRig as RiggingPlanRow);
    const { error: rigInsertError } = await supabase.from("rigging_plans").insert(payload as any);
    if (rigInsertError) return fail(rigInsertError.message);
  }

  return { ok: true, id: created.id, version: created.version };
}
