import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Megaphone } from "lucide-react";
import { format } from "date-fns";
import { ko } from "date-fns/locale";
import { toast } from "sonner";
import MobilePageHeader from "@/components/mobile/MobilePageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useMobileAccess } from "@/hooks/useMobileAccess";
import { usePreview } from "@/contexts/PreviewContext";
import {
  useMyFieldAnnouncements,
  type FieldAnnouncement,
} from "@/hooks/useMyFieldAnnouncements";
import { ackProjectAnnouncement } from "@/hooks/usePendingAnnouncements";
import { AnnouncementRow } from "@/components/announcements/TodayFieldAnnouncements";

export default function MobileAnnouncements() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { projectId } = useMobileAccess();
  const preview = usePreview();
  const effectiveProjectId = projectId || preview.previewProjectId;
  const { items, loading, reload } = useMyFieldAnnouncements(effectiveProjectId, 50);
  const focusId = params.get("id");
  const [open, setOpen] = useState<FieldAnnouncement | null>(null);
  const [acking, setAcking] = useState(false);

  const focused = useMemo(
    () => (focusId ? items.find((x) => x.id === focusId) || null : null),
    [focusId, items],
  );

  useEffect(() => {
    if (focused) setOpen(focused);
  }, [focused]);

  const openItem = (item: FieldAnnouncement) => {
    setOpen(item);
    setParams({ id: item.id }, { replace: true });
  };

  const close = () => {
    setOpen(null);
    setParams({}, { replace: true });
  };

  const ack = async () => {
    if (!open) return;
    setAcking(true);
    try {
      await ackProjectAnnouncement(open.id);
      await reload();
      toast.success("확인 처리되었습니다");
      close();
    } catch (e: any) {
      toast.error(e?.message || "확인 처리에 실패했습니다");
    } finally {
      setAcking(false);
    }
  };

  return (
    <div className="max-w-md mx-auto" data-testid="mobile-announcements">
      <MobilePageHeader
        title="현장 공지"
        subtitle="받은 공지를 다시 볼 수 있습니다"
        onBack={() => navigate("/app/worker/today")}
      />
      <main className="px-4 pb-6 space-y-2">
        {loading && items.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">불러오는 중…</p>
        )}
        {!loading && items.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            <Megaphone className="h-10 w-10 mx-auto opacity-30" />
            <p className="mt-2 text-sm">받은 공지가 없습니다</p>
          </div>
        )}
        <ul className="rounded-xl border divide-y overflow-hidden bg-background">
          {items.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="w-full text-left px-3 py-2.5 hover:bg-muted/40 transition-colors"
                onClick={() => openItem(a)}
              >
                <AnnouncementRow item={a} />
              </button>
            </li>
          ))}
        </ul>
      </main>

      <Dialog open={!!open} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-start gap-2 pr-6">
              <Megaphone className="h-5 w-5 shrink-0 mt-0.5" />
              <span className="leading-snug">{open?.title}</span>
            </DialogTitle>
          </DialogHeader>
          {open && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {open.require_ack && <Badge variant="secondary">필독</Badge>}
                {!open.acked_at && <Badge className="bg-amber-600">미확인</Badge>}
                {open.acked_at && <Badge variant="outline">확인함</Badge>}
              </div>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{open.body}</p>
              <p className="text-[11px] text-muted-foreground">
                {format(new Date(open.published_at), "yyyy.MM.dd HH:mm", { locale: ko })}
              </p>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            {!open?.acked_at ? (
              <Button className="w-full" disabled={acking} onClick={() => void ack()}>
                확인했습니다
              </Button>
            ) : (
              <Button variant="secondary" className="w-full" onClick={close}>
                닫기
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
