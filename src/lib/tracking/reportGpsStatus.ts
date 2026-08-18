import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { GpsBlockReason } from "@/lib/tracking/gpsStatusUi";
import {
  ACTIVE_PROJECT_CHANGED_EVENT,
  isActiveProjectStorageKey,
  readActiveProjectId,
} from "@/lib/activeProject";

export const GPS_STATUS_REPORT_DEBOUNCE_MS = 2_000;

type PendingReport = { projectId: string; reason: GpsBlockReason };

let pending: PendingReport | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastSentKey: string | null = null;

function reportKey(projectId: string, reason: GpsBlockReason): string {
  return `${projectId}:${reason ?? ""}`;
}

/** Map worker GPS UI to a server status. `undefined` = still booting, do not report. */
export function gpsStatusReportPayload(state: {
  tracking: boolean;
  suspended: boolean;
  block: GpsBlockReason;
}): GpsBlockReason | undefined {
  if (state.suspended) return "fence_probe_failed";
  if (state.tracking) return null;
  if (state.block) return state.block;
  return undefined;
}

async function flushReport(next: PendingReport): Promise<void> {
  const { error } = await supabase.rpc("report_worker_gps_status" as any, {
    _project_id: next.projectId,
    _block_reason: next.reason,
  });
  if (error && import.meta.env.DEV) {
    console.warn("[gps-status] report failed", error.message);
  }
}

/**
 * Status only — never sends coordinates (F-08).
 * Debounced so boot / StrictMode double-mount does not spam the RPC.
 */
export function reportWorkerGpsStatus(projectId: string, reason: GpsBlockReason): void {
  if (!projectId) return;
  pending = { projectId, reason };
  if (timer != null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const next = pending;
    pending = null;
    if (!next) return;
    const key = reportKey(next.projectId, next.reason);
    if (lastSentKey === key) return;
    lastSentKey = key;
    void flushReport(next);
  }, GPS_STATUS_REPORT_DEBOUNCE_MS);
}

/** Worker / badge: report current block reason for the selected project. */
export function useReportWorkerGpsStatus(reason: GpsBlockReason | undefined): void {
  useEffect(() => {
    if (reason === undefined) return;
    const send = () => {
      const projectId = readActiveProjectId();
      if (projectId) reportWorkerGpsStatus(projectId, reason);
    };
    send();
    const onStorage = (e: StorageEvent) => {
      if (isActiveProjectStorageKey(e.key) || e.key == null) send();
    };
    window.addEventListener(ACTIVE_PROJECT_CHANGED_EVENT, send);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(ACTIVE_PROJECT_CHANGED_EVENT, send);
      window.removeEventListener("storage", onStorage);
    };
  }, [reason]);
}

/** Test helper — not used in production. */
export function resetGpsStatusReportForTests(): void {
  if (timer != null) clearTimeout(timer);
  timer = null;
  pending = null;
  lastSentKey = null;
}
