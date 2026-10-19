import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listPendingAssessmentShares,
  pickPendingSharePrompts,
  type PendingAssessmentShare,
} from "@/lib/assessmentShareAck";
import { ACTIVE_PROJECT_CHANGED_EVENT, readActiveProjectId } from "@/lib/activeProject";

export function usePendingAssessmentShares(projectId?: string | null) {
  const [resolvedProjectId, setResolvedProjectId] = useState<string | null>(() =>
    projectId !== undefined ? projectId : readActiveProjectId() || null,
  );
  const [items, setItems] = useState<PendingAssessmentShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [dismissedRunIds, setDismissedRunIds] = useState<string[]>([]);

  useEffect(() => {
    if (projectId !== undefined) {
      setResolvedProjectId(projectId);
      return;
    }
    const sync = () => setResolvedProjectId(readActiveProjectId() || null);
    sync();
    window.addEventListener(ACTIVE_PROJECT_CHANGED_EVENT, sync);
    return () => window.removeEventListener(ACTIVE_PROJECT_CHANGED_EVENT, sync);
  }, [projectId]);

  const reload = useCallback(async () => {
    setLoading(true);
    const rows = await listPendingAssessmentShares(resolvedProjectId);
    setItems(rows);
    setLoading(false);
  }, [resolvedProjectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const dismiss = useCallback((item: PendingAssessmentShare | null | undefined) => {
    if (!item?.run_id) return;
    setDismissedRunIds((prev) => (prev.includes(item.run_id) ? prev : [...prev, item.run_id]));
  }, []);

  const visible = useMemo(
    () =>
      pickPendingSharePrompts(items, {
        dismissedRunIds,
      }),
    [items, dismissedRunIds],
  );

  return {
    items: visible,
    loading,
    reload,
    dismiss,
    current: visible[0] || null,
    remainingCount: Math.max(0, visible.length - 1),
  };
}
