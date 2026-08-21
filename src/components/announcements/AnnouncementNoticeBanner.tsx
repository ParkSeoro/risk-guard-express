import { Button } from "@/components/ui/button";
import { ackProjectAnnouncement, type PendingAnnouncement } from "@/hooks/usePendingAnnouncements";
import { Megaphone } from "lucide-react";
import { toast } from "sonner";

export default function AnnouncementNoticeBanner({
  item,
  onAcked,
}: {
  item: PendingAnnouncement;
  onAcked: () => void;
}) {
  const ack = async () => {
    try {
      await ackProjectAnnouncement(item.id);
      onAcked();
    } catch (e: any) {
      toast.error(e?.message || "확인 처리에 실패했습니다");
    }
  };

  return (
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 space-y-2">
      <p className="text-xs font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
        <Megaphone className="h-3.5 w-3.5" /> 현장 공지
      </p>
      <p className="text-sm font-medium leading-snug">{item.title}</p>
      {item.body && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{item.body}</p>}
      <Button size="sm" className="h-8 w-full" onClick={() => void ack()}>
        확인
      </Button>
    </div>
  );
}
