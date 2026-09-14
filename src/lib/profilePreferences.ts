import { supabase } from "@/integrations/supabase/client";
import { parseWorkerLocale, type WorkerLocale } from "@/lib/i18n/workerLocale";

export async function saveDefaultProjectId(userId: string, projectId: string | null): Promise<void> {
  const next = projectId ? String(projectId).trim() : null;
  const { error } = await supabase
    .from("profiles")
    .update({ default_project_id: next } as any)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function saveUiLocale(userId: string, locale: WorkerLocale): Promise<void> {
  const next = parseWorkerLocale(locale);
  const { error } = await supabase
    .from("profiles")
    .update({ ui_locale: next, ui_locale_chosen: true } as any)
    .eq("user_id", userId);
  if (error) throw error;
}