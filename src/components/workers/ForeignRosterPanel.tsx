import { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import {
  foreignRosterBadgeLabel,
  foreignRosterTransferPrompt,
  type ForeignRosterWorker,
} from "@/lib/workerCompanyTransfer";

export default function ForeignRosterPanel({
  projectId,
  companyId,
  destCompanyName,
  compact = false,
  onTransferred,
}: {
  projectId: string;
  companyId?: string;
  destCompanyName?: string;
  compact?: boolean;
  onTransferred?: () => void;
}) {
  const [rows, setRows] = useState<ForeignRosterWorker[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) {
      setRows([]);
      return;
    }
    const { data, error } = await (supabase as any).rpc("list_foreign_company_roster_workers", {
      _project_id: projectId,
      _company_id: companyId || null,
    });
    if (error) {
      setRows([]);
      return;
    }
    setRows((data || []) as ForeignRosterWorker[]);
  }, [projectId, companyId]);

  useEffect(() => {
    void load();
  }, [load]);

  const transfer = async (row: ForeignRosterWorker) => {
    const ok = window.confirm(
      foreignRosterTransferPrompt({
        name: row.name,
        source_company_name: row.source_company_name,
        dest_company_name: destCompanyName || row.login_company_name,
        is_active: row.is_active,
      }),
    );
    if (!ok) return;
    const toCompanyId = companyId || row.login_company_id;
    if (!toCompanyId) {
      toast.error("이관할 회사를 알 수 없습니다");
      return;
    }
    setBusyId(row.worker_id);
    try {
      const { data, error } = await (supabase as any).rpc("transfer_worker_company", {
        _worker_id: row.worker_id,
        _to_company_id: toCompanyId,
      });
      if (error) throw error;
      if (data?.error) throw new Error(String(data.error));
      toast.success(
        `${row.name}님을 ${destCompanyName || row.login_company_name || "우리 회사"} 명단으로 이관했습니다`,
      );
      await load();
      onTransferred?.();
    } catch (e: any) {
      toast.error(e?.message || "이관에 실패했습니다");
    } finally {
      setBusyId(null);
    }
  };

  if (!projectId || rows.length === 0) return null;

  return (
    <Card className="border-amber-300/70 bg-amber-50/40">
      <CardHeader className={compact ? "pb-2 pt-3 px-3" : undefined}>
        <CardTitle className="text-sm flex items-center gap-2">
          타사 소속 · 로그인 회사와 명단이 다름
          <Badge variant="outline">{rows.length}명</Badge>
        </CardTitle>
        <p className="text-[11px] text-muted-foreground">
          계정(로그인) 소속과 명단 소속이 다릅니다. 이관하면 로그인 회사 명단에 보이고, 원래 회사 명단에서는 빠집니다.
        </p>
      </CardHeader>
      <CardContent className={compact ? "px-3 pb-3 space-y-2" : "space-y-2"}>
        {rows.map((row) => (
          <div
            key={row.worker_id}
            className="flex items-center gap-2 rounded-md border bg-background p-2 text-sm"
          >
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">{row.name}</div>
              <div className="text-[11px] text-muted-foreground truncate">
                {row.phone}
                {row.job_type ? ` · ${row.job_type}` : ""}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                <Badge variant="outline" className="text-[10px]">
                  {foreignRosterBadgeLabel(row.source_company_name)}
                </Badge>
                {row.is_active === false && (
                  <Badge variant="outline" className="text-[10px] text-amber-800">
                    비활성
                  </Badge>
                )}
                {row.login_company_name && (
                  <Badge variant="secondary" className="text-[10px]">
                    로그인 {row.login_company_name}
                  </Badge>
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="shrink-0 gap-1"
              disabled={busyId === row.worker_id}
              onClick={() => void transfer(row)}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              이관
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
