import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type FieldAnnouncement = {
  id: string;
  project_id: string;
  title: string;
  body: string;
  require_ack: boolean;
  published_at: string;
  expires_at: string | null;
  acked_at: string | null;
};

export async function fetchMyFieldAnnouncements(
  projectId?: string | null,
  limit = 30,
): Promise<FieldAnnouncement[]> {
  const { data, error } = await supabase.rpc("list_my_field_announcements", {
    _project_id: projectId || null,
    _limit: limit,
  });
  if (error) throw error;
  return (data || []) as FieldAnnouncement[];
}

export function useMyFieldAnnouncements(projectId?: string | null, limit = 30) {
  const [items, setItems] = useState<FieldAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchMyFieldAnnouncements(projectId, limit);
      setItems(rows);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [projectId, limit]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const unread = items.filter((x) => !x.acked_at);
  return { items, unread, loading, reload };
}
