import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNavigateMobileHome } from "@/lib/mobileNav";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  QrCode,
  Search,
  UserPlus,
  Loader2,
  Copy,
  Ban,
  Unlock,
} from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";

import { useMobileAccess } from "@/hooks/useMobileAccess";
import { useAuditLog } from "@/hooks/useAuditLog";
import { isManagerMobileRole } from "@/lib/mobileShell";
import { usePreview, usePreviewWriteBlock } from "@/contexts/PreviewContext";
import SuspendWorkerDialog from "@/components/mobile/SuspendWorkerDialog";
import {
  formatSuspensionUntil,
  isWorkerCurrentlySuspended,
  suspensionKindLabel,
} from "@/lib/workerSuspension";

export default function MobileWorkers() {
  const navigate = useNavigate();
  const goMobileHome = useNavigateMobileHome();
  const { projectId, applyCompanyFilter, role, isMaster } = useMobileAccess();
  const preview = usePreview();
  const blockWrite = usePreviewWriteBlock();
  const { log: auditLog } = useAuditLog();
  const [workers, setWorkers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [qr, setQr] = useState<{ name: string; img: string; url: string } | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<{ id: string; name: string } | null>(null);

  const canSuspend = isManagerMobileRole(
    preview.isPreview ? preview.syntheticRole : role,
    preview.isPreview ? preview.syntheticRole === "master" : isMaster,
  );

  const load = async () => {
    if (!projectId) return;
    setLoading(true);
    let query: any = supabase
      .from("workers")
      .select(
        "*, site_entry_suspended_until, site_entry_suspension_reason, site_entry_suspension_kind",
      )
      .eq("project_id", projectId)
      .eq("is_active", true);
    query = applyCompanyFilter(query);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(200);
    if (error) toast.error("로드 실패: " + error.message);
    setWorkers(data || []);
    setLoading(false);
  };
  useEffect(() => {
    load(); /* eslint-disable-next-line */
  }, [projectId]);

  const filtered = workers.filter(
    (w) =>
      !q ||
      w.name?.includes(q) ||
      w.phone?.includes(q) ||
      w.company_name?.includes(q),
  );

  const showQr = async (w: any) => {
    try {
      const url = `${window.location.origin}/worker/portal/${w.qr_token}`;
      const img = await QRCode.toDataURL(url, { width: 320, margin: 1 });
      setQr({ name: w.name, img, url });
      await auditLog("view_qr", "worker", w.id, projectId || undefined, { name: w.name });
    } catch (e: any) {
      toast.error("QR 생성 실패: " + (e?.message || ""));
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("복사됨");
    } catch {
      toast.error("복사 실패");
    }
  };

  const lift = async (w: any) => {
    if (blockWrite()) {
      toast.message("프리뷰 모드에서는 데이터를 변경할 수 없습니다.");
      return;
    }
    const { data, error } = await supabase.rpc("set_worker_site_entry_suspension" as any, {
      _worker_id: w.id,
      _kind: "lift",
      _reason: null,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    if ((data as any)?.error) {
      toast.error((data as any).error);
      return;
    }
    toast.success("출입 정지 해제");
    load();
  };

  return (
    <div className="min-h-screen bg-muted/30 pb-24">
      <header className="bg-primary text-primary-foreground p-4 flex items-center gap-3 sticky top-0 z-10">
        <Button
          size="icon"
          variant="ghost"
          className="text-primary-foreground"
          onClick={() => goMobileHome()}
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="font-bold text-lg flex-1">근로자 · 출입</div>
        <Button size="sm" variant="secondary" onClick={() => navigate("/worker/register")}>
          <UserPlus className="h-4 w-4 mr-1" /> 등록
        </Button>
      </header>

      <main className="p-4 space-y-3 max-w-md mx-auto">
        <p className="text-xs text-muted-foreground">
          관리자는 여기서 현장 출입을 1일·3일·영구 정지할 수 있습니다. 정지된 근로자는 GPS/QR
          출근이 차단됩니다.
        </p>
        <div className="relative">
          <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="이름/전화/업체"
            className="pl-9 h-11"
          />
        </div>

        {loading && (
          <div className="text-center py-8">
            <Loader2 className="h-5 w-5 animate-spin inline" />
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="text-center text-muted-foreground py-12 text-sm">근로자가 없습니다</div>
        )}

        {filtered.map((w) => {
          const suspended = isWorkerCurrentlySuspended(w);
          return (
            <Card key={w.id} className={suspended ? "border-destructive/40" : undefined}>
              <CardContent className="pt-3 pb-3 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm truncate">{w.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {w.company_name || "—"} · {w.phone}
                    </div>
                    {w.education_confirmed_at && (
                      <Badge variant="secondary" className="text-[10px] mt-1">
                        교육완료
                      </Badge>
                    )}
                    {suspended && (
                      <Badge variant="destructive" className="text-[10px] mt-1 ml-1">
                        출입정지 · {suspensionKindLabel(w.site_entry_suspension_kind)}
                      </Badge>
                    )}
                  </div>
                  <Button size="sm" variant="outline" onClick={() => showQr(w)}>
                    <QrCode className="h-4 w-4 mr-1" /> QR
                  </Button>
                </div>
                {suspended && (
                  <div className="text-[11px] text-destructive/90">
                    {formatSuspensionUntil(
                      w.site_entry_suspended_until,
                      w.site_entry_suspension_kind,
                    )}
                    {w.site_entry_suspension_reason
                      ? ` · ${w.site_entry_suspension_reason}`
                      : ""}
                  </div>
                )}
                {canSuspend && (
                  <div className="flex gap-2">
                    {suspended ? (
                      <Button size="sm" variant="secondary" className="flex-1" onClick={() => lift(w)}>
                        <Unlock className="h-3.5 w-3.5 mr-1" /> 정지 해제
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="flex-1"
                        onClick={() => setSuspendTarget({ id: w.id, name: w.name })}
                      >
                        <Ban className="h-3.5 w-3.5 mr-1" /> 출입 정지
                      </Button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </main>

      <SuspendWorkerDialog
        open={!!suspendTarget}
        onOpenChange={(v) => !v && setSuspendTarget(null)}
        worker={suspendTarget}
        onDone={load}
      />

      {qr && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
          onClick={() => setQr(null)}
        >
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <CardContent className="pt-4 space-y-3 text-center">
              <div className="font-bold">{qr.name}</div>
              <img src={qr.img} alt="QR" className="mx-auto rounded border" />
              <div className="text-xs text-muted-foreground break-all">{qr.url}</div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => copy(qr.url)}>
                  <Copy className="h-4 w-4 mr-1" /> 링크 복사
                </Button>
                <Button onClick={() => setQr(null)}>닫기</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
