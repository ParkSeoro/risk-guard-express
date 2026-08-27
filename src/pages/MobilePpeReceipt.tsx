import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { usePreviewWriteBlock } from "@/contexts/PreviewContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ResponsiveSignaturePad, { type ResponsiveSignaturePadHandle } from "@/components/ResponsiveSignaturePad";
import { toast } from "sonner";
import { HardHat, Loader2 } from "lucide-react";

type PendingReceipt = {
  id: string;
  issued_at?: string | null;
  worker_name?: string | null;
  item_name?: string | null;
  quantity?: number | null;
  specification?: string | null;
  maker?: string | null;
  site_label?: string | null;
  receipt_status?: string | null;
};

function asRows(data: unknown): PendingReceipt[] {
  if (Array.isArray(data)) return data as PendingReceipt[];
  if (typeof data === "string") {
    try {
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default function MobilePpeReceipt() {
  const blockWrite = usePreviewWriteBlock();
  const [rows, setRows] = useState<PendingReceipt[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<PendingReceipt | null>(null);
  const [saving, setSaving] = useState(false);
  const sigRef = useRef<ResponsiveSignaturePadHandle | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("list_my_pending_ppe_receipts");
    if (error) {
      toast.error(error.message || "수령대기 목록을 불러오지 못했습니다.");
      setRows([]);
    } else {
      setRows(asRows(data));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function confirm() {
    if (!active) return;
    if (blockWrite()) {
      toast.message("프리뷰 모드에서는 데이터를 변경할 수 없습니다.");
      return;
    }
    if (sigRef.current?.isEmpty()) {
      toast.error("수령 서명이 필요합니다.");
      return;
    }
    setSaving(true);
    try {
      const signature = sigRef.current!.toDataURL("image/png");
      const { error } = await supabase.rpc("confirm_ppe_receipt", {
        _entry_id: active.id,
        _signature_data: signature,
      });
      if (error) throw error;
      toast.success("수령확인 완료. 지급대장·수불대장에 기록되었습니다.");
      setActive(null);
      sigRef.current?.clear();
      await load();
    } catch (e: any) {
      const msg = e?.message || String(e);
      toast.error(/insufficient_ppe_stock/i.test(msg) ? "재고가 부족합니다. 관리자에게 문의하세요." : msg);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 space-y-3 max-w-md mx-auto" data-testid="mobile-ppe-receipt">
      <div>
        <h1 className="text-base font-bold flex items-center gap-2">
          <HardHat className="h-4 w-4" /> 보호구 수령확인
        </h1>
        <p className="text-xs text-muted-foreground">
          서명하면 지급대장과 수불대장에 수령 일시가 함께 기록됩니다.
        </p>
      </div>

      {loading ? (
        <div className="text-sm text-muted-foreground py-8 flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> 목록 로딩 중…
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            수령 대기 중인 보호구가 없습니다.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <Card
              key={r.id}
              className={active?.id === r.id ? "border-primary" : ""}
              onClick={() => setActive(r)}
            >
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{r.item_name || "보호구"}</div>
                  <Badge variant="secondary" className="text-[10px]">대기</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {r.issued_at || "—"} · {r.quantity || 1}개
                  {r.specification ? ` · ${r.specification}` : ""}
                  {r.maker ? ` · ${r.maker}` : ""}
                </div>
                {r.site_label ? (
                  <div className="text-[11px] text-muted-foreground">{r.site_label}</div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {active && (
        <Card>
          <CardContent className="p-3 space-y-3">
            <div className="text-sm font-medium">
              {active.item_name} 수령 서명
            </div>
            <div className="rounded-md border bg-background">
              <ResponsiveSignaturePad ref={sigRef} height={160} />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => sigRef.current?.clear()}>
                지우기
              </Button>
              <Button className="flex-1" disabled={saving} onClick={confirm}>
                {saving ? "저장 중…" : "수령확인"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
