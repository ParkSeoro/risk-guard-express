import { supabase } from "@/integrations/supabase/client";

/** Batch-load project names for notification / detail UIs. */
export async function fetchProjectNames(ids: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  if (uniq.length === 0) return {};
  const { data, error } = await supabase.from("projects").select("id, name").in("id", uniq);
  if (error || !Array.isArray(data)) return {};
  const out: Record<string, string> = {};
  for (const row of data) {
    const id = String(row?.id || "").trim();
    const name = String(row?.name || "").trim();
    if (id && name) out[id] = name;
  }
  return out;
}

export function prefixNotificationProject(text: string, projectName?: string | null): string {
  const name = String(projectName || "").trim();
  const body = String(text || "").trim();
  if (!name || !body) return body;
  if (body.startsWith(`[${name}]`)) return body;
  return `[${name}] ${body}`;
}
