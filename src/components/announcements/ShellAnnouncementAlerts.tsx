import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ackProjectAnnouncement, usePendingAnnouncements } from "@/hooks/usePendingAnnouncements";
import { toast } from "sonner";
import { Megaphone } from "lucide-react";

/**
 * Blocking 필독 공지. GPS/위험구역 사이렌 모달과 분리.
 */
export default function ShellAnnouncementAlerts() {
  const { required, reload } = usePendingAnnouncements();
  const current = required[0] || null;

  const ack = async () => {
    if (!current) return;
    try {
      await ackProjectAnnouncement(current.id);
      await reload();
    } catch (e: any) {
      toast.error(e?.message || "확인 처리에 실패했습니다");
    }
  };

  return (
    <Dialog
      open={!!current}
      onOpenChange={(next) => {
        if (!next) return;
      }}
    >
      <DialogContent
        className="max-w-md [&>button.absolute]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5" /> 필독 공지
          </DialogTitle>
          <DialogDescription>{current?.title}</DialogDescription>
        </DialogHeader>
        <p className="text-sm whitespace-pre-wrap leading-relaxed">{current?.body}</p>
        <DialogFooter>
          <Button className="w-full" onClick={() => void ack()}>
            확인했습니다
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
