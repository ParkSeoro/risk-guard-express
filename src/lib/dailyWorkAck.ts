/**
 * Daily work acknowledgment — confirm assigned permits + risk summary, sign once.
 */
import { supabase } from "@/integrations/supabase/client";

export type DailyPermitBrief = {
  id: string;
  work_name: string;
  work_description: string;
  work_location: string;
  permit_date: string;
  tbm_session_id: string | null;
  assessment_run_id: string | null;
};

export type DailyAckPayload = {
  projectId: string;
  workerId: string;
  userId?: string | null;
  workerName: string;
  workerPhone: string;
  entryLogId?: string | null;
  permitIds: string[];
  workSummary: string;
  riskSummary: string;
  signatureData: string;
};

export function todaySeoulDate(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

/** Seoul calendar-day bounds for timestamptz filters (never naive UTC midnight). */
export function seoulDayRange(day = todaySeoulDate()): { start: string; end: string } {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(String(day || "").trim())
    ? String(day).trim()
    : todaySeoulDate();
  return {
    start: `${d}T00:00:00+09:00`,
    end: `${d}T23:59:59.999+09:00`,
  };
}

/** Permits for today where this worker is assigned (expected crew). */
export async function fetchWorkerDayPermits(
  projectId: string,
  workerId: string,
  day = todaySeoulDate(),
): Promise<DailyPermitBrief[]> {
  const { data: links } = await supabase
    .from("work_permit_workers" as any)
    .select("work_permit_id")
    .eq("worker_id", workerId)
    .eq("project_id", projectId);
  const ids = ((links as any[]) || []).map((r) => r.work_permit_id).filter(Boolean);
  if (ids.length === 0) return [];

  const { data: permits } = await supabase
    .from("work_permits" as any)
    .select(
      "id, work_name, work_description, location, permit_date, form_data, tbm_session_id, assessment_run_id, status, is_deleted",
    )
    .in("id", ids)
    .eq("permit_date", day)
    .eq("is_deleted", false);

  return ((permits as any[]) || []).map((p) => {
    const fd = p.form_data || {};
    return {
      id: p.id,
      work_name: fd.work_name || p.work_name || "",
      work_description: fd.work_description || p.work_description || "",
      work_location: fd.work_location || p.location || "",
      permit_date: p.permit_date,
      tbm_session_id: p.tbm_session_id || null,
      assessment_run_id: p.assessment_run_id || null,
    };
  });
}

export function buildWorkSummary(permits: DailyPermitBrief[]): string {
  if (permits.length === 0) {
    return "오늘 배정된 작업허가서가 없습니다. 현장 기본 안전수칙을 준수하세요.";
  }
  return permits
    .map((p, i) => {
      const title = p.work_name || p.work_description || `작업 ${i + 1}`;
      const loc = p.work_location ? ` @ ${p.work_location}` : "";
      const desc =
        p.work_description && p.work_description !== p.work_name
          ? `\n  - ${p.work_description}`
          : "";
      return `${i + 1}. ${title}${loc}${desc}`;
    })
    .join("\n");
}

/** Pull top hazards from linked assessment runs (if any). */
export async function buildRiskSummary(permits: DailyPermitBrief[]): Promise<string> {
  const runIds = [...new Set(permits.map((p) => p.assessment_run_id).filter(Boolean))] as string[];
  if (runIds.length === 0) {
    return [
      "연결된 위험성평가가 배정되지 않았습니다. 아래 기본 안전수칙을 반드시 준수하세요.",
      "1. 안전모·안전화·필요 PPE를 착용하고 작업에 임합니다.",
      "2. 위험구역·제한구역에 무단 진입하지 않습니다.",
      "3. 관리자 TBM·현장 지시에 따르고, 이상 징후·아차사고는 즉시 보고합니다.",
      "4. 작업 전 주변 위험요인(추락·협착·화재·중독 등)을 재확인합니다.",
    ].join("\n");
  }
  const { data: items } = await supabase
    .from("risk_items")
    .select("hazard, hazard_situation, improvement_measure, risk_grade, process")
    .in("run_id", runIds)
    .order("risk_grade", { ascending: false })
    .limit(12);
  const rows = (items as any[]) || [];
  if (rows.length === 0) {
    return "위험성평가 항목을 불러오지 못했습니다. 현장 관리자 지시에 따르세요.";
  }
  return rows
    .map((r, i) => {
      const hz = r.hazard || r.hazard_situation || "위험";
      const m = r.improvement_measure ? ` → ${r.improvement_measure}` : "";
      return `${i + 1}. [${r.process || "-"}] ${hz}${m}`;
    })
    .join("\n");
}

export async function saveDailyWorkAck(payload: DailyAckPayload): Promise<{ id: string } | { error: string }> {
  const ackDate = todaySeoulDate();
  const row = {
    project_id: payload.projectId,
    worker_id: payload.workerId,
    user_id: payload.userId || null,
    worker_name: payload.workerName,
    worker_phone: payload.workerPhone,
    ack_date: ackDate,
    permit_ids: payload.permitIds,
    work_summary: payload.workSummary,
    risk_summary: payload.riskSummary,
    confirmed_work: true,
    confirmed_risk: true,
    signature_data: payload.signatureData,
    entry_log_id: payload.entryLogId || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("worker_daily_acks" as any)
    .upsert(row as any, { onConflict: "project_id,worker_id,ack_date" })
    .select("id")
    .maybeSingle();

  // Partial unique index may not work as onConflict target — fallback insert/update
  if (error) {
    const { data: existing } = await supabase
      .from("worker_daily_acks" as any)
      .select("id")
      .eq("project_id", payload.projectId)
      .eq("worker_id", payload.workerId)
      .eq("ack_date", ackDate)
      .maybeSingle();
    if ((existing as any)?.id) {
      const { data: upd, error: uerr } = await supabase
        .from("worker_daily_acks" as any)
        .update(row as any)
        .eq("id", (existing as any).id)
        .select("id")
        .single();
      if (uerr) return { error: uerr.message };
      await syncAckToTbm(payload);
      return { id: (upd as any).id };
    }
    const { data: ins, error: ierr } = await supabase
      .from("worker_daily_acks" as any)
      .insert(row as any)
      .select("id")
      .single();
    if (ierr) return { error: ierr.message };
    await syncAckToTbm(payload);
    return { id: (ins as any).id };
  }

  await syncAckToTbm(payload);
  return { id: (data as any)?.id };
}

/** Reuse daily signature on linked TBM sessions (if any). */
async function syncAckToTbm(payload: DailyAckPayload) {
  if (!payload.permitIds.length) return;
  const { data: permits } = await supabase
    .from("work_permits" as any)
    .select("tbm_session_id")
    .in("id", payload.permitIds);
  const tbmIds = [
    ...new Set(
      ((permits as any[]) || []).map((p) => p.tbm_session_id).filter(Boolean),
    ),
  ] as string[];
  for (const tbmId of tbmIds) {
    const { data, error } = await supabase.rpc("upsert_tbm_participation_from_ack", {
      _tbm_session_id: tbmId,
      _worker_id: payload.workerId,
      _signature_data: payload.signatureData,
    });
    if (error) {
      console.warn("TBM 서명 동기화 실패", tbmId, error.message);
      continue;
    }
    const rpcErr = (data as { error?: string; message?: string } | null)?.error;
    if (rpcErr) {
      console.warn("TBM 서명 동기화 실패", tbmId, rpcErr, (data as any)?.message);
    }
  }
}

export async function fetchTodayAck(
  projectId: string,
  workerId: string,
): Promise<{ id: string; signature_data: string } | null> {
  const { data } = await supabase
    .from("worker_daily_acks" as any)
    .select("id, signature_data")
    .eq("project_id", projectId)
    .eq("worker_id", workerId)
    .eq("ack_date", todaySeoulDate())
    .maybeSingle();
  return (data as any) || null;
}
