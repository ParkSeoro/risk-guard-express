import { useCallback, useEffect, useState } from "react";
import {
  listPendingAssessmentShares,
  type PendingAssessmentShare,
} from "@/lib/assessmentShareAck";

export function usePendingAssessmentShares(projectId?: string | null) {
  const [items, setItems] = useState<PendingAssessmentShare[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const rows = await listPendingAssessmentShares(projectId);
    setItems(rows);
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { items, loading, reload, current: items[0] || null };
}
