import { supabase } from "@/integrations/supabase/client";
import { ANONYMOUS_REPORTER_LABEL, applyRevealedWorkStopName } from "@/lib/workStop";
import { notificationPreview } from "@/lib/notificationText";
import { prefixNotificationProject } from "@/lib/projectNames";

/** PM+ only — RPC returns no rows for company managers. */
export async function fetchRevealedWorkStopNames(ids: string[]): Promise<Record<string, string>> {
  const uniq = [...new Set(ids.map((id) => String(id || "").trim()).filter(Boolean))];
  if (uniq.length === 0) return {};
  const { data, error } = await (supabase as any).rpc("reveal_work_stop_reporters", { _ids: uniq });
  if (error || !Array.isArray(data)) return {};
  const out: Record<string, string> = {};
  for (const row of data) {
    const id = String(row?.id || "").trim();
    const name = String(row?.legal_name || "").trim();
    if (id && name && name !== ANONYMOUS_REPORTER_LABEL) out[id] = name;
  }
  return out;
}

export function workStopIdsFromNotifications(
  items: Array<{ type?: string | null; related_type?: string | null; related_id?: string | null }>,
): string[] {
  return items
    .filter((n) => {
      const t = n.type || "";
      const rt = n.related_type || "";
      return t === "work_stop" || t === "work_stop_request" || rt === "work_stop" || rt === "work_stop_request";
    })
    .map((n) => String(n.related_id || "").trim())
    .filter(Boolean);
}

export function decorateWorkStopNotificationPreview(
  n: { message?: string | null; body?: string | null; project_id?: string | null; related_id?: string | null },
  names: Record<string, string>,
  projects: Record<string, string>,
): string {
  return prefixNotificationProject(
    applyRevealedWorkStopName(notificationPreview(n), names[String(n.related_id || "")]),
    projects[String(n.project_id || "")],
  );
}
