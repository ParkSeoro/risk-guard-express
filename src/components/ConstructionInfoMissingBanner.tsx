import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle } from "lucide-react";

interface Props {
  projectId: string | null | undefined;
  companyId?: string | null;
  contextLabel?: string;
}

export function ConstructionInfoMissingBanner({ projectId, companyId, contextLabel }: Props) {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let active = true;
    if (!projectId) {
      setMissing(false);
      return;
    }
    (async () => {
      let query = (supabase as any)
        .from("company_construction_info")
        .select("construction_amount, construction_period_start, construction_period_end")
        .eq("project_id", projectId);
      if (companyId) query = query.eq("company_id", companyId);
      const { data, error } = await query;
      if (!active || error) return;
      const rows = (data || []) as Array<{
        construction_amount?: number | null;
        construction_period_start?: string | null;
        construction_period_end?: string | null;
      }>;
      const hasValid = rows.some(
        (r) =>
          Number(r.construction_amount || 0) > 0 &&
          Boolean(r.construction_period_start) &&
          Boolean(r.construction_period_end),
      );
      setMissing(!hasValid);
    })();
    return () => {
      active = false;
    };
  }, [projectId, companyId]);

  if (!projectId || !missing) return null;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3.5 py-2.5 text-xs text-amber-900 dark:text-amber-200 flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-amber-600" />
        <span>
          <strong>공사금액·기간 미등록:</strong>{" "}
          {contextLabel || "안전관리자 선임 기준·산업안전보건관리비·법적의무"} 자동 판정을 위해 계약 정보를 등록해 주세요. (미등록 상태에서도 저장·작업은 계속 가능합니다)
        </span>
      </div>
      <Link
        to={`/projects/${projectId}`}
        className="font-semibold underline underline-offset-2 text-amber-800 dark:text-amber-100 whitespace-nowrap"
      >
        현장 상세에서 입력하기 →
      </Link>
    </div>
  );
}
