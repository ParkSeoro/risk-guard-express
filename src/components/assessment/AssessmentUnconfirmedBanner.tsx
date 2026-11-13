import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

type Row = { worker_id: string; worker_name: string; run_id: string; period_label: string | null };

export function AssessmentUnconfirmedBanner({
  projectId,
  workerIds = [],
  phones = [],
}: {
  projectId: string | null | undefined;
  workerIds?: string[];
  phones?: string[];
}) {
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    const ids = workerIds.filter(Boolean);
    const nums = phones.map((p) => p.trim()).filter(Boolean);
    if (!projectId || (ids.length === 0 && nums.length === 0)) {
      setRows([]);
      return;
    }
    let cancelled = false;
    void supabase
      .rpc("list_unconfirmed_assessment_workers" as any, {
        _project_id: projectId,
        _worker_ids: ids,
        _phones: nums,
      })
      .then(({ data }) => {
        if (!cancelled) setRows((data || []) as Row[]);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, workerIds.join("|"), phones.join("|")]);

  if (rows.length === 0) return null;
  const shown = rows.slice(0, 3);
  const runId = shown[0]?.run_id;
  return (
    <div className="print:hidden rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 space-y-1">
      {shown.map((row) => (
        <p key={row.worker_id}>{row.worker_name}은 이 작업의 위험성평가를 아직 확인하지 않았습니다.</p>
      ))}
      {rows.length > shown.length && (
        <p className="text-xs">외 {rows.length - shown.length}명</p>
      )}
      {runId && (
        <Link to={`/assessment-run/${runId}`} className="text-xs underline">
          확인 열기
        </Link>
      )}
    </div>
  );
}
