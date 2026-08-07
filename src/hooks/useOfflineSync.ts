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

async function flushOnce() {
  if (!isOnline()) return;
  const items = await listQueue();
  if (items.length === 0) return;
  let ok = 0;
  for (const it of items) {
    try {
      if (it.kind === "inspection_item") {
        const p = it.payload;
        const urls: string[] = [];
        for (const ph of (p.photos || [])) {
          const f = await dataUrlToFile(ph.data, ph.name);
          const ext = (ph.name.split(".").pop() || "jpg");
          const path = `${p.projectId}/mobile-inspect/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
          try {
            const uploaded = await uploadAttachmentFile(path, f);
            urls.push(uploaded.publicUrl);
          } catch {
            /* skip failed offline photo */
          }
        }
        const { data: ins } = await supabase.from("safety_inspections" as any).insert({
          project_id: p.projectId, inspection_type: "patrol", process_category: "기타",
          location: p.location, summary: p.issue, inspector_name: p.inspector || "",
          status: p.result === "fail" ? "in_progress" : "completed",
        }).select().single();
        if (ins) {
          await supabase.from("safety_inspection_items" as any).insert({
            inspection_id: (ins as any).id, checklist_code: "MOBILE",
            label: p.issue || "현장 점검", legal_basis: "", result: p.result, photos: urls, sort_order: 0,
          });
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
      await removeFromQueue(it.id!);
      ok++;
    } catch (e) {
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
