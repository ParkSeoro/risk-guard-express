import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PendingAnnouncement = {
  id: string;
  project_id: string;
  title: string;
  body: string;
  require_ack: boolean;
  published_at: string;
  expires_at: string | null;
};

export async function ackProjectAnnouncement(id: string): Promise<void> {
  const { error } = await supabase.rpc("ack_project_announcement", { _announcement_id: id });
  if (error) throw error;
}

export function usePendingAnnouncements(projectId?: string | null) {
  const [items, setItems] = useState<PendingAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_my_pending_announcements", {
      _project_id: projectId || null,
    });
    if (error) {
      setItems([]);
      setLoading(false);
      return;
    }
    setItems((data || []) as PendingAnnouncement[]);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const required = items.filter((x) => x.require_ack);
  const notices = items.filter((x) => !x.require_ack);

  return { items, required, notices, loading, reload };
}
