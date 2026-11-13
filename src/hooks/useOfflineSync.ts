import { useEffect } from "react";
import { listQueue, removeFromQueue, isOnline } from "@/lib/offlineQueue";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { uploadAttachmentFile } from "@/lib/compressUploadFile";

// 온라인 복귀 시 큐 자동 동기화
async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type });
}

const MAX_SESSION_RETRIES = 5;
const sessionRetryCounts = new Map<number, number>();

async function flushOnce() {
  if (!isOnline()) return;
  const items = await listQueue();
  if (items.length === 0) return;
  let ok = 0;
  for (const it of items) {
    const itemId = it.id;
    if (itemId != null && (sessionRetryCounts.get(itemId) ?? 0) >= MAX_SESSION_RETRIES) {
      continue;
    }
    try {
      if (it.kind === "inspection_item") {
        const p = it.payload;
        const urls: string[] = [];
        for (const ph of (p.photos || [])) {
          const f = await dataUrlToFile(ph.data, ph.name);
          const ext = (ph.name.split(".").pop() || "jpg");
          const path = `${p.projectId}/mobile-inspect/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          const uploaded = await uploadAttachmentFile(path, f);
          urls.push(uploaded.publicUrl);
        }
        const { data: ins, error: insErr } = await supabase.from("safety_inspections" as any).insert({
          project_id: p.projectId, inspection_type: "patrol", process_category: "기타",
          location: p.location, summary: p.issue, inspector_name: p.inspector || "",
          status: p.result === "fail" ? "in_progress" : "completed",
        }).select().single();
        if (insErr || !ins) {
          throw insErr || new Error("safety_inspections insert returned no row");
        }
        const { error: itemErr } = await supabase.from("safety_inspection_items" as any).insert({
          inspection_id: (ins as any).id, checklist_code: "MOBILE",
          label: p.issue || "현장 점검", legal_basis: "", result: p.result, photos: urls, sort_order: 0,
        });
        if (itemErr) {
          throw itemErr;
        }
      } else if (it.kind === "rpc") {
        // Generic queued RPC. Payload: { fn: string, args: Record<string,any> }
        // The server-side function should accept `_idempotency_key` to dedupe replays.
        const p = it.payload || {};
        const args = { ...(p.args || {}) };
        if (it.idempotencyKey && !("_idempotency_key" in args)) {
          args._idempotency_key = it.idempotencyKey;
        }
        const { error } = await supabase.rpc(p.fn, args);
        if (error) throw error;
      }
      if (itemId != null) {
        sessionRetryCounts.delete(itemId);
        await removeFromQueue(itemId);
      }
      ok++;
    } catch (e) {
      if (itemId != null) {
        const next = (sessionRetryCounts.get(itemId) ?? 0) + 1;
        sessionRetryCounts.set(itemId, next);
        if (next === MAX_SESSION_RETRIES) {
          toast.error("오프라인 대기 항목 동기화가 반복 실패하여 일시 중단되었습니다.");
        }
      }
      if (import.meta.env.DEV) console.warn("sync fail", e);
    }
  }
  if (ok > 0) toast.success(`동기화 완료: ${ok}건`);
}

export function useOfflineSync() {
  useEffect(() => {
    flushOnce();
    const onOnline = () => flushOnce();
    window.addEventListener("online", onOnline);
    const t = setInterval(flushOnce, 60_000);
    return () => { window.removeEventListener("online", onOnline); clearInterval(t); };
  }, []);
}
