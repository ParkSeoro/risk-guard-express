/**
 * Admin labor-evidence API: hours, signature ledger, exceptions, corrections.
 * Prefers RPCs; falls back to table reads + workHours.ts when the migration is not applied yet.
 */
import { supabase } from "@/integrations/supabase/client";
import { seoulDayRange } from "@/lib/dailyWorkAck";
import {
  buildWorkHourRow,
  formatWorkHours,
  HoursRollupGroup,
  PLEDGE_HASHES,
  PLEDGE_TEXTS,
  pledgeTextByHash,
  rollupWorkHours,
  summarizeHours,
  type HoursRollup,
  type WorkHourRow,
} from "@/lib/workHours";
import { isWorkerCurrentlySuspended } from "@/lib/workerSuspension";

export type SignatureKind = "daily_ack" | "no_accident" | "tbm" | "ra_share" | "ppe" | "consent";

export type SignatureLedgerRow = {
  id: string;
  kind: SignatureKind;
  kindLabel: string;
  workerId: string | null;
  workerName: string;
  companyName: string | null;
  signatureData: string | null;
  signedAt: string | null;
  pledgeTextHash: string | null;
  detail: string | null;
  workDate: string | null;
};

export type ExceptionItem = {
  workerId: string | null;
  workerName: string;
  companyName?: string | null;
  jobType?: string | null;
  detail?: string | null;
  entryLogId?: string | null;
  entryAt?: string | null;
  workDate?: string | null;
  itemType?: string | null;
  subtype?: string | null;
  dueDate?: string | null;
  status?: string | null;
  blockReason?: string | null;
  workPermitId?: string | null;
  workName?: string | null;
  itemName?: string | null;
  count?: number | null;
};

export type AttendanceExceptions = {
  date: string;
  missingAttendance: ExceptionItem[];
  missingExit: ExceptionItem[];
  missingDailyAck: ExceptionItem[];
  missingTbm: ExceptionItem[];
  duplicateEntry: ExceptionItem[];
  overdueRequired: ExceptionItem[];
  missingHealthLog: ExceptionItem[];
  gpsBlocked: ExceptionItem[];
  permitNoShow: ExceptionItem[];
  ppePending: ExceptionItem[];
};

const KIND_LABEL: Record<SignatureKind, string> = {
  daily_ack: "일일서약",
  no_accident: "무재해 서약",
  tbm: "TBM",
  ra_share: "위험성평가 공유",
  ppe: "보호구 수령",
  consent: "앱 동의",
};

function rpcMissing(message: string | undefined) {
  const m = String(message || "").toLowerCase();
  return m.includes("does not exist") || m.includes("could not find") || m.includes("schema cache");
}

function asRows(data: unknown): any[] {
  if (Array.isArray(data)) return data;
  return [];
}

export function mapHourRpcRow(raw: any): WorkHourRow {
  return buildWorkHourRow({
    entryLogId: raw.entry_log_id || raw.id,
    workerId: raw.worker_id,
    workerName: raw.worker_name,
    entryAt: raw.entry_at,
    exitAt: raw.exit_at,
    jobType: raw.job_type,
    companyId: raw.company_id,
    companyName: raw.company_name,
  });
}

async function fetchHourRowsFallback(
  projectId: string,
  from: string,
  to: string,
): Promise<WorkHourRow[]> {
  const start = seoulDayRange(from).start;
  const end = seoulDayRange(to).end;
  const { data: logs, error } = await supabase
    .from("worker_entry_logs")
    .select("id, worker_id, entry_at, exit_at, entry_method")
    .eq("project_id", projectId)
    .gte("entry_at", start)
    .lte("entry_at", end)
    .order("entry_at", { ascending: false })
    .limit(4000);
  if (error) throw new Error(error.message);
  const ids = [...new Set((logs || []).map((l) => l.worker_id).filter(Boolean))];
  let workers: Record<string, any> = {};
  if (ids.length) {
    const { data: ws } = await supabase
      .from("workers")
      .select("id, name, phone, job_type, company_id, company_name")
      .in("id", ids);
    workers = Object.fromEntries((ws || []).map((w) => [w.id, w]));
  }
  return (logs || []).map((l) =>
    buildWorkHourRow({
      entryLogId: l.id,
      workerId: l.worker_id,
      workerName: workers[l.worker_id]?.name,
      entryAt: l.entry_at,
      exitAt: l.exit_at,
      jobType: workers[l.worker_id]?.job_type,
      companyId: workers[l.worker_id]?.company_id,
      companyName: workers[l.worker_id]?.company_name,
    }),
  );
}

export async function fetchWorkHourRows(opts: {
  projectId: string;
  from: string;
  to: string;
}): Promise<WorkHourRow[]> {
  const { data, error } = await supabase.rpc("get_work_hours_rows" as any, {
    _project_id: opts.projectId,
    _from: opts.from,
    _to: opts.to,
  });
  if (!error) return asRows(data).map(mapHourRpcRow);
  if (!rpcMissing(error.message)) throw new Error(error.message);
  return fetchHourRowsFallback(opts.projectId, opts.from, opts.to);
}

export async function fetchHoursRollup(opts: {
  projectId: string;
  from: string;
  to: string;
  group: HoursRollupGroup;
}): Promise<{ rows: WorkHourRow[]; rollup: HoursRollup[]; summary: ReturnType<typeof summarizeHours> }> {
  const rows = await fetchWorkHourRows(opts);
  return {
    rows,
    rollup: rollupWorkHours(rows, opts.group),
    summary: summarizeHours(rows),
  };
}

function mapLedger(raw: any): SignatureLedgerRow {
  const kind = (raw.kind || "daily_ack") as SignatureKind;
  return {
    id: String(raw.id),
    kind,
    kindLabel: raw.kind_label || KIND_LABEL[kind] || kind,
    workerId: raw.worker_id || null,
    workerName: raw.worker_name || "",
    companyName: raw.company_name || null,
    signatureData: raw.signature_data || null,
    signedAt: raw.signed_at || null,
    pledgeTextHash: raw.pledge_text_hash || null,
    detail: raw.detail || null,
    workDate: raw.work_date || null,
  };
}

async function fetchLedgerFallback(opts: {
  projectId: string;
  workerId?: string | null;
  from: string;
  to: string;
}): Promise<SignatureLedgerRow[]> {
  const start = seoulDayRange(opts.from).start;
  const end = seoulDayRange(opts.to).end;
  const rows: SignatureLedgerRow[] = [];

  let ackQ = supabase
    .from("worker_daily_acks" as any)
    .select("id, worker_id, worker_name, signature_data, created_at, pledge_text_hash, work_summary, ack_date")
    .eq("project_id", opts.projectId)
    .gte("ack_date", opts.from)
    .lte("ack_date", opts.to)
    .limit(2000);
  if (opts.workerId) ackQ = ackQ.eq("worker_id", opts.workerId);
  const { data: acks } = await ackQ;
  for (const a of (acks as any[]) || []) {
    rows.push(
      mapLedger({
        id: a.id,
        kind: "daily_ack",
        kind_label: KIND_LABEL.daily_ack,
        worker_id: a.worker_id,
        worker_name: a.worker_name,
        signature_data: a.signature_data,
        signed_at: a.created_at,
        pledge_text_hash: a.pledge_text_hash,
        detail: a.work_summary,
        work_date: a.ack_date,
      }),
    );
  }

  let exitQ = supabase
    .from("worker_entry_logs")
    .select("id, worker_id, exit_signature_data, exit_at, entry_at, no_accident_confirmed")
    .eq("project_id", opts.projectId)
    .gte("entry_at", start)
    .lte("entry_at", end)
    .not("exit_signature_data", "is", null)
    .limit(2000);
  if (opts.workerId) exitQ = exitQ.eq("worker_id", opts.workerId);
  const { data: exits } = await exitQ;
  const exitIds = [...new Set((exits || []).map((e) => e.worker_id))];
  let wmap: Record<string, any> = {};
  if (exitIds.length) {
    const { data: ws } = await supabase.from("workers").select("id, name, company_name").in("id", exitIds);
    wmap = Object.fromEntries((ws || []).map((w) => [w.id, w]));
  }
  for (const e of exits || []) {
    rows.push(
      mapLedger({
        id: e.id,
        kind: "no_accident",
        kind_label: KIND_LABEL.no_accident,
        worker_id: e.worker_id,
        worker_name: wmap[e.worker_id]?.name,
        company_name: wmap[e.worker_id]?.company_name,
        signature_data: e.exit_signature_data,
        signed_at: e.exit_at || e.entry_at,
        detail: e.no_accident_confirmed ? "무재해 확인" : "퇴근 서명",
        work_date: String(e.entry_at || "").slice(0, 10),
      }),
    );
  }

  const { data: sessions } = await supabase
    .from("tbm_sessions")
    .select("id, tbm_date")
    .eq("project_id", opts.projectId)
    .eq("is_deleted", false)
    .gte("tbm_date", opts.from)
    .lte("tbm_date", opts.to);
  const sessionIds = (sessions || []).map((s) => s.id);
  const sessionDate = Object.fromEntries((sessions || []).map((s) => [s.id, s.tbm_date]));
  if (sessionIds.length) {
    let tq = supabase
      .from("tbm_participations")
      .select("id, worker_id, worker_name, company_name, signature_data, participated_at, tbm_session_id")
      .in("tbm_session_id", sessionIds)
      .limit(3000);
    if (opts.workerId) tq = tq.eq("worker_id", opts.workerId);
    const { data: parts } = await tq;
    for (const p of parts || []) {
      rows.push(
        mapLedger({
          id: p.id,
          kind: "tbm",
          kind_label: KIND_LABEL.tbm,
          worker_id: p.worker_id,
          worker_name: p.worker_name,
          company_name: p.company_name,
          signature_data: p.signature_data,
          signed_at: p.participated_at,
          detail: "TBM 참여",
          work_date: sessionDate[p.tbm_session_id],
        }),
      );
    }
  }

  let raQ = supabase
    .from("assessment_run_share_acks")
    .select("id, worker_id, worker_name, company_name, signature_data, signed_at, source")
    .eq("project_id", opts.projectId)
    .gte("signed_at", start)
    .lte("signed_at", end)
    .limit(2000);
  if (opts.workerId) raQ = raQ.eq("worker_id", opts.workerId);
  const { data: ras } = await raQ;
  for (const a of ras || []) {
    rows.push(
      mapLedger({
        id: a.id,
        kind: "ra_share",
        kind_label: KIND_LABEL.ra_share,
        worker_id: a.worker_id,
        worker_name: a.worker_name,
        company_name: a.company_name,
        signature_data: a.signature_data,
        signed_at: a.signed_at,
        detail: a.source,
        work_date: String(a.signed_at || "").slice(0, 10),
      }),
    );
  }

  rows.sort((a, b) => String(b.signedAt || "").localeCompare(String(a.signedAt || "")));
  return rows;
}

export async function fetchSignatureLedger(opts: {
  projectId: string;
  workerId?: string | null;
  from: string;
  to: string;
}): Promise<SignatureLedgerRow[]> {
  const { data, error } = await supabase.rpc("list_worker_signature_ledger" as any, {
    _project_id: opts.projectId,
    _worker_id: opts.workerId || null,
    _from: opts.from,
    _to: opts.to,
  });
  if (!error) return asRows(data).map(mapLedger);
  if (!rpcMissing(error.message)) throw new Error(error.message);
  return fetchLedgerFallback(opts);
}

function emptyExceptions(date: string): AttendanceExceptions {
  return {
    date,
    missingAttendance: [],
    missingExit: [],
    missingDailyAck: [],
    missingTbm: [],
    duplicateEntry: [],
    overdueRequired: [],
    missingHealthLog: [],
    gpsBlocked: [],
    permitNoShow: [],
    ppePending: [],
  };
}

function mapExItem(raw: any): ExceptionItem {
  return {
    workerId: raw.worker_id || null,
    workerName: raw.worker_name || "",
    companyName: raw.company_name,
    jobType: raw.job_type,
    detail: raw.detail,
    entryLogId: raw.entry_log_id,
    entryAt: raw.entry_at,
    workDate: raw.work_date,
    itemType: raw.item_type,
    subtype: raw.subtype,
    dueDate: raw.due_date,
    status: raw.status,
    blockReason: raw.block_reason,
    workPermitId: raw.work_permit_id,
    workName: raw.work_name,
    itemName: raw.item_name,
    count: raw.count,
  };
}

async function fetchExceptionsFallback(projectId: string, date: string): Promise<AttendanceExceptions> {
  const out = emptyExceptions(date);
  const range = seoulDayRange(date);
  const { data: workers } = await supabase
    .from("workers")
    .select(
      "id, name, company_name, job_type, is_active, phone, requires_daily_health_log, site_entry_suspended_until",
    )
    .eq("project_id", projectId)
    .eq("is_active", true)
    .limit(3000);
  const roster = (workers || []) as any[];
  const { data: logs } = await supabase
    .from("worker_entry_logs")
    .select("id, worker_id, entry_at, exit_at, tbm_confirmed")
    .eq("project_id", projectId)
    .gte("entry_at", range.start)
    .lte("entry_at", range.end)
    .limit(4000);
  const todayLogs = logs || [];
  const present = new Set(todayLogs.map((l) => l.worker_id));
  const byWorker = new Map<string, typeof todayLogs>();
  for (const l of todayLogs) {
    const arr = byWorker.get(l.worker_id) || [];
    arr.push(l);
    byWorker.set(l.worker_id, arr);
  }

  for (const w of roster) {
    if (isWorkerCurrentlySuspended(w)) continue;
    if (!present.has(w.id)) {
      out.missingAttendance.push({
        workerId: w.id,
        workerName: w.name,
        companyName: w.company_name,
        jobType: w.job_type,
      });
    }
  }

  const { data: openLogs } = await supabase
    .from("worker_entry_logs")
    .select("id, worker_id, entry_at, exit_at")
    .eq("project_id", projectId)
    .is("exit_at", null)
    .lt("entry_at", range.end)
    .limit(1000);
  const openIds = [...new Set((openLogs || []).map((l) => l.worker_id))];
  const openNames = new Map<string, any>();
  if (openIds.length) {
    const { data: ws } = await supabase.from("workers").select("id, name, company_name").in("id", openIds);
    (ws || []).forEach((w) => openNames.set(w.id, w));
  }
  for (const e of openLogs || []) {
    out.missingExit.push({
      workerId: e.worker_id,
      workerName: openNames.get(e.worker_id)?.name || "",
      companyName: openNames.get(e.worker_id)?.company_name,
      entryLogId: e.id,
      entryAt: e.entry_at,
    });
  }

  const { data: acks } = await supabase
    .from("worker_daily_acks" as any)
    .select("worker_id")
    .eq("project_id", projectId)
    .eq("ack_date", date)
    .limit(2000);
  const ackSet = new Set(((acks as any[]) || []).map((a) => a.worker_id));
  for (const l of todayLogs) {
    if (!ackSet.has(l.worker_id)) {
      const w = roster.find((r) => r.id === l.worker_id);
      out.missingDailyAck.push({
        workerId: l.worker_id,
        workerName: w?.name || "",
        companyName: w?.company_name,
        entryAt: l.entry_at,
      });
    }
  }

  const { data: sessions } = await supabase
    .from("tbm_sessions")
    .select("id")
    .eq("project_id", projectId)
    .eq("tbm_date", date)
    .eq("is_deleted", false);
  if ((sessions || []).length) {
    const { data: parts } = await supabase
      .from("tbm_participations")
      .select("worker_id, worker_phone, briefing_confirmed")
      .in(
        "tbm_session_id",
        (sessions || []).map((s) => s.id),
      );
    const tbmWorkers = new Set(
      (parts || [])
        .filter((p) => p.briefing_confirmed !== false)
        .map((p) => p.worker_id)
        .filter(Boolean),
    );
    for (const l of todayLogs) {
      if (l.tbm_confirmed || tbmWorkers.has(l.worker_id)) continue;
      const w = roster.find((r) => r.id === l.worker_id);
      out.missingTbm.push({
        workerId: l.worker_id,
        workerName: w?.name || "",
        companyName: w?.company_name,
      });
    }
  }

  for (const [wid, arr] of byWorker) {
    if (arr.length > 1) {
      const w = roster.find((r) => r.id === wid);
      out.duplicateEntry.push({
        workerId: wid,
        workerName: w?.name || "",
        companyName: w?.company_name,
        count: arr.length,
      });
    }
  }

  const { data: reqs } = await supabase
    .from("worker_required_items")
    .select("worker_id, item_type, subtype, due_date, status")
    .eq("project_id", projectId)
    .eq("is_deleted", false)
    .neq("status", "done")
    .limit(2000);
  for (const r of reqs || []) {
    if (r.status !== "overdue" && r.due_date && r.due_date > date) continue;
    const w = roster.find((x) => x.id === r.worker_id);
    if (!w) continue;
    out.overdueRequired.push({
      workerId: r.worker_id,
      workerName: w.name,
      companyName: w.company_name,
      itemType: r.item_type,
      subtype: r.subtype,
      dueDate: r.due_date,
      status: r.status,
    });
  }

  const healthTargets = roster.filter((w) => w.requires_daily_health_log && present.has(w.id));
  if (healthTargets.length) {
    const { data: logsH } = await supabase
      .from("worker_daily_health_logs")
      .select("worker_id")
      .eq("log_date", date)
      .eq("is_deleted", false)
      .in(
        "worker_id",
        healthTargets.map((w) => w.id),
      );
    const logged = new Set((logsH || []).map((h) => h.worker_id));
    for (const w of healthTargets) {
      if (!logged.has(w.id)) {
        out.missingHealthLog.push({
          workerId: w.id,
          workerName: w.name,
          companyName: w.company_name,
        });
      }
    }
  }

  const { data: gps } = await supabase
    .from("worker_gps_status" as any)
    .select("worker_id, block_reason, updated_at")
    .eq("project_id", projectId)
    .limit(500);
  for (const st of (gps as any[]) || []) {
    const w = roster.find((x) => x.id === st.worker_id);
    out.gpsBlocked.push({
      workerId: st.worker_id,
      workerName: w?.name || "",
      companyName: w?.company_name,
      blockReason: st.block_reason,
      detail: st.updated_at,
    });
  }

  const { data: links } = await supabase
    .from("work_permit_workers" as any)
    .select("worker_id, work_permit_id")
    .eq("project_id", projectId)
    .limit(3000);
  const permitIds = [...new Set(((links as any[]) || []).map((l) => l.work_permit_id))];
  if (permitIds.length) {
    const { data: permits } = await supabase
      .from("work_permits" as any)
      .select("id, work_name, permit_date, is_deleted")
      .in("id", permitIds)
      .eq("permit_date", date)
      .eq("is_deleted", false);
    const todayPermits = new Set(((permits as any[]) || []).map((p) => p.id));
    const pname = Object.fromEntries(((permits as any[]) || []).map((p) => [p.id, p.work_name]));
    for (const l of (links as any[]) || []) {
      if (!todayPermits.has(l.work_permit_id)) continue;
      if (present.has(l.worker_id)) continue;
      const w = roster.find((x) => x.id === l.worker_id);
      out.permitNoShow.push({
        workerId: l.worker_id,
        workerName: w?.name || "",
        companyName: w?.company_name,
        workPermitId: l.work_permit_id,
        workName: pname[l.work_permit_id],
      });
    }
  }

  return out;
}

export async function fetchAttendanceExceptions(
  projectId: string,
  date: string,
): Promise<AttendanceExceptions> {
  const { data, error } = await supabase.rpc("list_attendance_exceptions" as any, {
    _project_id: projectId,
    _date: date,
  });
  if (!error && data && typeof data === "object") {
    const d = data as any;
    return {
      date: d.date || date,
      missingAttendance: asRows(d.missing_attendance).map(mapExItem),
      missingExit: asRows(d.missing_exit).map(mapExItem),
      missingDailyAck: asRows(d.missing_daily_ack).map(mapExItem),
      missingTbm: asRows(d.missing_tbm).map(mapExItem),
      duplicateEntry: asRows(d.duplicate_entry).map(mapExItem),
      overdueRequired: asRows(d.overdue_required).map(mapExItem),
      missingHealthLog: asRows(d.missing_health_log).map(mapExItem),
      gpsBlocked: asRows(d.gps_blocked).map(mapExItem),
      permitNoShow: asRows(d.permit_no_show).map(mapExItem),
      ppePending: asRows(d.ppe_pending).map(mapExItem),
    };
  }
  if (error && !rpcMissing(error.message)) throw new Error(error.message);
  return fetchExceptionsFallback(projectId, date);
}

export async function correctWorkerEntryLog(opts: {
  entryLogId: string;
  entryAt: string;
  exitAt: string | null;
  reason: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("correct_worker_entry_log" as any, {
    _entry_log_id: opts.entryLogId,
    _entry_at: opts.entryAt,
    _exit_at: opts.exitAt,
    _reason: opts.reason,
  });
  if (error) return { ok: false, error: error.message };
  if ((data as any)?.ok === false) return { ok: false, error: "정정에 실패했습니다" };
  return { ok: true };
}

export async function syncWorkerProfileIdentity(opts: {
  workerId: string;
  name: string;
  phone: string;
  jobType: string;
  birthDate: string | null;
  hireDate: string | null;
  emergencyName: string;
  emergencyPhone: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.rpc("sync_worker_profile_identity" as any, {
    _worker_id: opts.workerId,
    _name: opts.name,
    _phone: opts.phone,
    _job_type: opts.jobType,
    _birth_date: opts.birthDate || null,
    _hire_date: opts.hireDate || null,
    _emergency_name: opts.emergencyName,
    _emergency_phone: opts.emergencyPhone,
  });
  if (!error) return { ok: true };
  if (!rpcMissing(error.message)) return { ok: false, error: error.message };

  const { error: uerr } = await supabase
    .from("workers")
    .update({
      name: opts.name,
      phone: opts.phone,
      job_type: opts.jobType || null,
      birth_date: opts.birthDate || null,
      hire_date: opts.hireDate || null,
      emergency_name: opts.emergencyName || null,
      emergency_phone: opts.emergencyPhone || null,
    } as any)
    .eq("id", opts.workerId);
  if (uerr) return { ok: false, error: uerr.message };
  return { ok: true };
}

export function resolvePledgeText(kind: SignatureKind, hash: string | null | undefined): string | null {
  const fromHash = pledgeTextByHash(hash);
  if (fromHash) return fromHash;
  if (kind === "daily_ack") return PLEDGE_TEXTS.work;
  if (kind === "no_accident") return PLEDGE_TEXTS.no_accident;
  return null;
}

export function hoursDisclaimer() {
  return "표시 시간은 GPS 출·퇴근 실측이며 공수는 8시간=1.0 환산입니다. 급여·수당 기준이 아닙니다.";
}

export { formatWorkHours, KIND_LABEL, PLEDGE_HASHES };
