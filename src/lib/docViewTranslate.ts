import { supabase } from "@/integrations/supabase/client";
import { parseWorkerLocale, type WorkerLocale } from "@/lib/i18n/workerLocale";

export type DocViewEntityType = "assessment_run" | "work_plan" | "work_permit" | "tbm_session";

function stableHash(fields: Record<string, string>): string {
  const keys = Object.keys(fields).sort();
  const body = keys.map((k) => `${k}=${fields[k] ?? ""}`).join("\n");
  let h = 2166136261;
  for (let i = 0; i < body.length; i++) {
    h ^= body.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

export async function translateDocViewFields(opts: {
  entityType: DocViewEntityType;
  entityId: string;
  locale: WorkerLocale;
  fields: Record<string, string>;
}): Promise<Record<string, string>> {
  const locale = parseWorkerLocale(opts.locale);
  const fields = Object.fromEntries(
    Object.entries(opts.fields || {}).map(([k, v]) => [k, String(v ?? "").trim()]),
  );
  if (locale === "ko") return fields;
  const contentHash = stableHash(fields);

  const { data: cached } = await supabase
    .from("doc_view_translations" as any)
    .select("payload")
    .eq("entity_type", opts.entityType)
    .eq("entity_id", opts.entityId)
    .eq("locale", locale)
    .eq("content_hash", contentHash)
    .maybeSingle();
  const hit = (cached as { payload?: Record<string, string> } | null)?.payload;
  if (hit && typeof hit === "object") return { ...fields, ...hit };

  const { data, error } = await supabase.functions.invoke("translate-doc-view", {
    body: {
      entity_type: opts.entityType,
      entity_id: opts.entityId,
      locale,
      content_hash: contentHash,
      fields,
    },
  });
  if (error) throw error;
  const payload = (data as { payload?: Record<string, string> } | null)?.payload;
  if (payload && typeof payload === "object") return { ...fields, ...payload };
  return fields;
}